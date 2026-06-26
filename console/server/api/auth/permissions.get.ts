/**
 * 获取当前用户权限。
 *
 * Console 权限来自本地已验签 Platform policy bundle，不再代理 Account。
 * GET /api/auth/permissions
 */
import { appCode } from '~~/app/config/permissions'
import {
  isPolicyAuthorizationError,
  loadPolicyAuthorizationSnapshot,
  type PolicyAuthorizationRole
} from '~~/server/utils/policyAuthorization'
import { resolveConsoleSession } from '~~/server/utils/authSession'
import { getQuery, setHeader } from 'h3'

interface PermissionsResponse {
  code: number
  data: {
    uid: string
    roles: string[]
    availableRoles: PolicyAuthorizationRole[]
    activeRoleCode: string
    authorizationMode: string
    bundleVersion: string
    bundleHash: string
    resources: Record<string, string[]>
  }
}

export default defineEventHandler(async (event): Promise<PermissionsResponse> => {
  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  setHeader(event, 'Expires', '0')

  const session = await resolveConsoleSession(event)
  const uid = session.uid
  const query = getQuery(event)
  const targetAppCode = String(Array.isArray(query.appCode) ? query.appCode[0] : query.appCode || appCode).trim() || appCode
  const authorizationMode = String(Array.isArray(query.authorizationMode) ? query.authorizationMode[0] : query.authorizationMode || '').trim()

  try {
    const snapshot = await loadPolicyAuthorizationSnapshot(uid, targetAppCode, event, {
      authorizationMode
    })
    return {
      code: 0,
      data: {
        uid: snapshot.uid,
        roles: snapshot.roles,
        availableRoles: snapshot.availableRoles,
        activeRoleCode: snapshot.activeRoleCode,
        authorizationMode: snapshot.authorizationMode,
        bundleVersion: snapshot.bundleVersion,
        bundleHash: snapshot.bundleHash,
        resources: snapshot.resources
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (isPolicyAuthorizationError(error)) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: 'Policy Authorization Unavailable',
        message: error.message,
        data: {
          reason: error.reason
        }
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Policy Authorization Failed',
      message
    })
  }
})
