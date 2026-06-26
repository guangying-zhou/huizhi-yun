/**
 * 获取当前用户 scoped authorization。
 *
 * Console 权限来自本地已验签 Platform policy bundle，不再代理 Account。
 * POST /api/auth/scoped-authorization
 */
import { createError, readBody, setHeader } from 'h3'
import { appCode } from '~~/app/config/permissions'
import { resolveConsoleSession } from '~~/server/utils/authSession'
import {
  isPolicyAuthorizationError
} from '~~/server/utils/policyAuthorization'
import { loadPolicyScopedAuthorization } from '~~/server/utils/policyScopedAuthorization'
import type { FoundationObjectContext } from '@hzy/foundation/server/utils/scopeEvaluator'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  setHeader(event, 'Expires', '0')

  const session = await resolveConsoleSession(event)
  const body = await readBody<Record<string, unknown>>(event)
  const targetAppCode = stringValue(body.appCode) || appCode

  try {
    const snapshot = await loadPolicyScopedAuthorization(session.uid, targetAppCode, event, {
      activeRoleCode: stringValue(body.activeRoleCode),
      authorizationMode: stringValue(body.authorizationMode),
      resourceCode: stringValue(body.resourceCode),
      action: stringValue(body.action),
      object: (body.object && typeof body.object === 'object' && !Array.isArray(body.object))
        ? body.object as FoundationObjectContext
        : undefined
    })

    return {
      code: 0,
      data: snapshot
    }
  } catch (error) {
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

    const message = error instanceof Error ? error.message : String(error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Policy Scoped Authorization Failed',
      message
    })
  }
})
