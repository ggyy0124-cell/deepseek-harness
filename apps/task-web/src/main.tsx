/** Browser entry for the Task Web client. */
import '@deepseek-ai/dsh-client-ui-theme/src/styles/base.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/corner-shape.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/focus.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/scrollbar.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/gradient-shadow-text.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/shiki.css'
import './styles/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import { TaskConnection } from './support/connection.ts'
import { TaskEventHub } from './support/events.ts'
import { applyPreferences } from './support/preferences.ts'

applyPreferences()
const connection = new TaskConnection(document.baseURI)
const events = new TaskEventHub(connection)
/** Take the launch secret out of the address bar and history before exchanging it; it is single-use. */
const takeFragment = (): string => {
  const fragment = location.hash
  if (fragment.startsWith('#launch=')) history.replaceState(null, '', location.pathname + location.search)
  return fragment
}
// Opening a new launch link in a tab already showing the client changes only the fragment.
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#launch=')) void connection.start(takeFragment())
})
const root = document.getElementById('root')
if (root === null) throw new Error('task web: missing #root')
createRoot(root).render(<StrictMode><App connection={connection} events={events} /></StrictMode>)
void connection.start(takeFragment())
