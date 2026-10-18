/** Model double that answers each request from its latest input, so concurrent parent and child requests stay deterministic. */
import { LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** One answer selected when the request's latest input contains `match`; `hang` streams until the request aborts. */
export type Route = readonly [match: string, answer: StreamChunk[] | 'hang']

/** Answer by the first route whose text occurs in the request's latest input. */
export class RoutedAdapter extends LlmAdapter {
  /** Every request this adapter received, in arrival order. */
  readonly requests: GenerateOptions[] = []

  constructor(private readonly routes: readonly Route[]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const input = latestInput(options)
    const route = this.routes.find(([match]) => input.includes(match))
    if (route === undefined) throw new Error(`RoutedAdapter: no route for ${JSON.stringify(input)}`)
    const [, answer] = route
    if (answer === 'hang') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial' }
      await new Promise<void>((_resolve, reject) => {
        if (options.signal?.aborted === true) { reject(new Error('aborted')); return }
        options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      })
      return
    }
    for (const chunk of answer) yield chunk
  }
}

/** Text of the newest conversation input: the prompt, tool result, or settled-child notice the model answers. System,
 * developer, and runtime-context messages describe the request rather than the input. */
function latestInput(options: GenerateOptions): string {
  const message = options.messages.findLast(candidate => candidate.role !== 'system' && candidate.role !== 'developer'
    && candidate.source?.kind !== 'runtime-context')
  if (message === undefined) return ''
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}
