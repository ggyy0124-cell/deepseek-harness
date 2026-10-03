/** Markdown rendering with localized code-card chrome. */
import { useMemo } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'

/** Render Markdown from plugins and the Agent; raw HTML and unsafe links are disabled by the renderer.
 * @param props.text - Markdown source.
 * @param props.compact - tighter spacing for cards.
 * @returns rendered document.
 */
export function Markdown({ text, compact = false }: { text: string; compact?: boolean }) {
  const t = useT()
  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t.markdown.copy, copiedLabel: t.markdown.copied, toolbarLabels: { codeLabel: t.markdown.code,
      wrapLabel: t.markdown.wrap, unwrapLabel: t.markdown.unwrap } },
    footnotes: t.markdown.footnotes,
  }), [t])
  return <MarkdownText text={text} labels={labels} variant={compact ? 'compact' : 'body'} />
}
