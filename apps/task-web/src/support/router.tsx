/** History-API router for the Task Web pages. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'

/** Parsed location: decoded path segments and query parameters. */
export interface Route {
  readonly path: string
  readonly segments: readonly string[]
  readonly query: URLSearchParams
}

interface RouterValue {
  readonly route: Route
  readonly navigate: (to: string, options?: { replace?: boolean }) => void
}

const RouterContext = createContext<RouterValue | null>(null)

function parse(): Route {
  const path = location.pathname
  return {
    path,
    segments: path.split('/').filter(Boolean).map(segment => decodeURIComponent(segment)),
    query: new URLSearchParams(location.search),
  }
}

/** Provide the current route and navigation to the page tree.
 * @param props.children - application tree.
 * @returns router provider.
 */
export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const update = () => { setRoute(parse()) }
    window.addEventListener('popstate', update)
    return () => { window.removeEventListener('popstate', update) }
  }, [])
  const navigate = useCallback((to: string, options: { replace?: boolean } = {}) => {
    if (to === location.pathname + location.search) return
    if (options.replace === true) history.replaceState(null, '', to)
    else history.pushState(null, '', to)
    setRoute(parse())
    if (options.replace !== true) document.querySelector('main')?.scrollTo({ top: 0 })
  }, [])
  const value = useMemo(() => ({ route, navigate }), [route, navigate])
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

/** Read the router.
 * @returns current route and navigation.
 */
export function useRouter(): RouterValue {
  const value = useContext(RouterContext)
  if (value === null) throw new Error('useRouter requires RouterProvider')
  return value
}

/** In-app link that navigates without reloading; modified clicks keep browser behavior.
 * @param props.to - application path and query.
 * @returns anchor element.
 */
export function Link({ to, onClick, children, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter()
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
  }
  return <a href={to} onClick={click} {...rest}>{children}</a>
}

/** Path builders for every page. */
export const paths = {
  overview: () => '/',
  definitions: () => '/definitions',
  definition: (id: string, tab?: 'runs' | 'lifecycle') => `/definitions/${encodeURIComponent(id)}${tab === undefined ? '' : `?tab=${tab}`}`,
  runs: (query?: Record<string, string>) => {
    const search = new URLSearchParams(query).toString()
    return `/runs${search === '' ? '' : `?${search}`}`
  },
  run: (id: string) => `/runs/${encodeURIComponent(id)}`,
  inbox: () => '/inbox',
  diagnostics: () => '/diagnostics',
}
