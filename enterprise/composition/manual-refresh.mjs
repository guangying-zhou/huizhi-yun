export const MANUAL_HMR_MARKER = 'hzy0 manual-refresh: HMR transport disabled'

// Vite still serves @vite/client when server.hmr=false. Retain CSS/style
// helpers, but never connect its transport (including reconnect/full-reload).
export function disableHmrTransport(code, id) {
  if (!/[/]vite[/]dist[/]client[/]client\.mjs(?:\?|$)/.test(id)) return null
  const connect = 'transport.connect(createHMRHandler(handleMessage));'
  if (!code.includes(connect)) throw new Error('Unrecognized Vite HMR client: manual refresh gate failed')
  return code.replace(connect, `/* ${MANUAL_HMR_MARKER} */`)
}

/** @returns {{ name: string, apply: 'serve', enforce: 'pre', transform: typeof disableHmrTransport }} */
export function manualRefreshPlugin() {
  return { name: 'hzy0-manual-refresh', apply: 'serve', enforce: 'pre', transform: disableHmrTransport }
}
