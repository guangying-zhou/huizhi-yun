import { defineEventHandler, getQuery, getRequestURL, sendRedirect, setHeader } from 'h3'

// Console completes the OIDC logout and returns to the registered Enterprise
// post-logout URI. Send the browser straight to Console's signed-out page.
export default defineEventHandler((event) => {
  if (event.method !== 'GET' || getRequestURL(event).pathname !== '/enterprise/login') return
  if (getQuery(event).state !== 'logged_out') return

  const config = useRuntimeConfig(event)
  const oidcConfig = config.hzy?.consoleOidc as { logoutRedirectUri?: string } | undefined
  const registeredReturn = String(oidcConfig?.logoutRedirectUri || '')
  const consoleUrl = String(config.hzy?.consoleRuntime?.consoleApiUrl || '')
  let landing: URL
  let consoleBase: URL
  try {
    landing = new URL(registeredReturn)
    consoleBase = new URL(consoleUrl)
  } catch {
    return
  }
  if (landing.protocol !== 'https:' || landing.pathname !== '/enterprise/login'
    || landing.search || landing.hash || landing.username || landing.password
    || consoleBase.protocol !== 'https:' || consoleBase.username || consoleBase.password
    || consoleBase.search || consoleBase.hash) return

  const consoleLogin = process.env.HZY0_LOCAL_CONSOLE_FACADE === 'true'
    ? new URL('/console/login', landing.origin)
    : new URL(`${consoleBase.pathname.replace(/\/+$/, '')}/login`, consoleBase.origin)
  consoleLogin.searchParams.set('logged_out', '1')
  consoleLogin.searchParams.set('redirect', new URL('/enterprise', landing.origin).toString())

  setHeader(event, 'cache-control', 'private, no-store')
  return sendRedirect(event, consoleLogin.toString(), 302)
})
