import { defineEventHandler } from 'h3'
import { getAuthRequestIp, writeAuthLoginEvent } from '~~/server/utils/authAudit'
import { resolveOptionalConsoleSession, revokeConsoleSession, setConsoleLogoutMarker } from '~~/server/utils/authSession'

export default defineEventHandler(async (event) => {
  const session = await resolveOptionalConsoleSession(event, { touch: false })

  await revokeConsoleSession(event)
  setConsoleLogoutMarker(event)

  if (session) {
    await writeAuthLoginEvent({
      uid: session.uid,
      identityId: session.identityId,
      targetApp: 'console',
      authProvider: session.authProvider,
      loginType: 'logout',
      loginResult: 'success',
      sessionId: session.storedSessionId,
      ipAddress: getAuthRequestIp(event)
    })
  }

  return {
    code: 0,
    data: {
      loggedOut: true
    }
  }
})
