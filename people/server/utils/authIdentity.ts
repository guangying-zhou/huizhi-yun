import { getCookie, type H3Event } from 'h3'

type ConsoleAuthContext = {
  authenticated?: boolean
  uid?: string
}

// Local BFF endpoints consume the identity established by the shared Console
// middleware. Legacy cookie support remains explicitly opt-in for the existing
// compatibility mode; callers never supply an actor UID in a request body.
export function getRequestUid(event: H3Event) {
  const auth = event.context.consoleAuth as ConsoleAuthContext | undefined
  const uid = String(auth?.uid || '').trim()
  if (auth?.authenticated && uid) return uid
  const config = useRuntimeConfig(event) as { hzy?: { legacyAuthBridge?: unknown, authMode?: unknown } }
  const legacy = config.hzy?.authMode === 'legacy' || config.hzy?.legacyAuthBridge === true
  return legacy ? String(getCookie(event, 'auth_user') || '').trim() : ''
}
