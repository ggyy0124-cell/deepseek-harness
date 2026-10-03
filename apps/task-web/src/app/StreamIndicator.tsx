/** Floating indicator of the Task event stream after it loses its connection. */
import { useRef } from 'react'
import { ConnectionIndicator, type ConnectionIndicatorState } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { useStore } from '../lib/store.ts'
import { useApp } from './context.tsx'

/** Show disconnection, reconnection and recovery of the Task event stream; the first connection stays silent.
 * @returns indicator container.
 */
export function StreamIndicator() {
  const t = useT()
  const { events } = useApp()
  const state = useStore(events.state)
  const outage = useRef(false)
  if (state === 'disconnected') outage.current = true
  let shown: ConnectionIndicatorState | undefined
  if (state === 'disconnected') shown = 'disconnected'
  else if (state === 'recovered') shown = 'recovered'
  else if (state === 'connecting' && outage.current) shown = 'connecting'
  if (state === 'connected' || state === 'recovered') outage.current = false
  return (
    <div className="tw-stream-indicator">
      <ConnectionIndicator state={shown}
        disconnectedLabel={t.stream.disconnected} connectingLabel={t.stream.connecting} recoveredLabel={t.stream.recovered}
        reconnectActionLabel={t.stream.reconnect} restartActionLabel={t.stream.restart}
        onReconnect={() => { events.reconnect() }} />
    </div>
  )
}
