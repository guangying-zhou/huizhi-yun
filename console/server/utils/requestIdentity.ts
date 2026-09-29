import type { H3Event } from 'h3'
import { readConsoleSessionCookie, resolveConsoleSession } from '~~/server/utils/authSession'
import { consoleSessionActorContext } from '~~/server/utils/consoleSessionActor'
import { verifyAccessToken } from '~~/server/utils/oidc'

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

// A business app (the Enterprise Host) calls a registered Console user API with
// the signed-in user's app access token instead of a Console session cookie.
// The Foundation console-auth middleware marks only those routes as a bypass
// carrying the token; it is verified here with Console's own published keys,
// issuer and live session, exactly like the notification routes.
async function verifiedAppAccessUid(event: H3Event) {
  const auth = event.context.consoleAuth as {
    reason?: string
    token?: string | null
    tokenUse?: string | null
    subjectType?: string | null
  } | undefined
  const token = text(auth?.token)
  if (auth?.reason !== 'bypass' || auth.tokenUse !== 'access' || auth.subjectType !== 'user' || !token) return ''
  const payload = await verifyAccessToken(event, token)
  const uid = text((payload.hzy as { uid?: unknown } | undefined)?.uid) || text(payload.sub).replace(/^user:/, '')
  if (!uid) return ''
  event.context.consoleAuth = { ...auth, authenticated: true, subjectType: 'user', uid, subjectCode: uid, token, tokenUse: 'access' }
  return uid
}

export async function requireConsoleRequestUid(event: H3Event) {
  // Console's own pages keep using the session cookie.
  if (!readConsoleSessionCookie(event)) {
    const uid = await verifiedAppAccessUid(event)
    if (uid) return uid
  }
  const session = await resolveConsoleSession(event)
  event.context.consoleAuth = consoleSessionActorContext(
    session,
    event.context.consoleAuth as Record<string, unknown> | undefined
  )
  return session.uid
}
