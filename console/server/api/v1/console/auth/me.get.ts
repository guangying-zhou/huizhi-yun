import { defineEventHandler } from 'h3'
import { resolveOptionalConsoleSession } from '~~/server/utils/authSession'

export default defineEventHandler(async (event) => {
  const session = await resolveOptionalConsoleSession(event, { allowLegacyFallback: false })

  if (!session) {
    return {
      code: 0,
      data: {
        authenticated: false,
        session: null,
        subject: null,
        directory: null
      }
    }
  }

  const user = session.user

  return {
    code: 0,
    data: {
      authenticated: true,
      session: {
        sid: session.storedSessionId,
        issuedAt: session.issuedAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        authProvider: session.authProvider
      },
      subject: {
        subjectType: 'user',
        subjectCode: session.uid,
        uid: session.uid
      },
      identity: {
        identityId: session.identityId,
        providerCode: session.identity.providerCode,
        providerSubject: session.identity.providerSubject
      },
      directory: {
        uid: user.uid,
        username: user.username || null,
        displayName: user.displayName || user.realName || user.username || user.uid,
        realName: user.realName || null,
        nickname: user.nickname || null,
        email: user.email || null,
        avatarUrl: user.avatarUrl || user.avatar || null,
        primaryDeptCode: user.primaryDeptCode || user.deptCode || null,
        primaryDeptName: user.primaryDeptName || user.deptName || null,
        positionTitle: user.positionTitle || null,
        userType: user.userType || null
      }
    }
  }
})
