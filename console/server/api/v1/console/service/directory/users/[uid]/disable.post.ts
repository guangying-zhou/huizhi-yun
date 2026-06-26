import { createError, getHeader, getRouterParam, readBody } from 'h3'
import type { ResultSetHeader } from 'mysql2/promise'
import { updateDirectoryUser } from '~~/server/utils/directoryAdmin'
import { getDirectoryUserForAdmin } from '~~/server/utils/directoryRuntime'
import { execute } from '~~/server/utils/db'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

interface DisableDirectoryUserBody {
  sourceApp?: string
  reason?: string
  operatorUid?: string
  leaveDate?: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function directoryStatusKey(value: unknown) {
  if (value === 1 || value === '1' || value === 'active') return 'active'
  if (value === -1 || value === '-1' || value === 'deleted') return 'deleted'
  return 'inactive'
}

async function revokeUserSessions(uid: string) {
  const refreshResult = await execute<ResultSetHeader>(
    `UPDATE auth_refresh_tokens rt
       INNER JOIN local_sessions ls ON ls.id = rt.session_id
          SET rt.status = 'revoked',
              rt.revoked_at = COALESCE(rt.revoked_at, UTC_TIMESTAMP())
        WHERE ls.uid = ?
          AND rt.status IN ('active', 'rotated')`,
    [uid]
  )

  const sessionResult = await execute<ResultSetHeader>(
    `UPDATE local_sessions
        SET status = 'revoked',
            revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()),
            updated_at = UTC_TIMESTAMP()
      WHERE uid = ?
        AND status = 'active'`,
    [uid]
  )

  return {
    refreshTokens: refreshResult.affectedRows || 0,
    sessions: sessionResult.affectedRows || 0
  }
}

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(event, 'console_directory', 'console_directory:write')
  if (actor.appCode !== 'people') {
    throw createError({ statusCode: 403, message: 'Only People service may disable directory users through this endpoint.' })
  }

  const uid = text(getRouterParam(event, 'uid'))
  if (!uid) throw createError({ statusCode: 400, message: 'uid is required' })

  const body = await readBody<DisableDirectoryUserBody>(event).catch(() => ({} as DisableDirectoryUserBody))
  const sourceApp = text(body.sourceApp) || actor.appCode || ''
  if (sourceApp !== actor.appCode) {
    throw createError({ statusCode: 403, message: 'sourceApp does not match service identity.' })
  }

  const existing = await getDirectoryUserForAdmin(uid)
  if (!existing) throw createError({ statusCode: 404, message: `Directory user not found: ${uid}` })

  const idempotencyKey = text(getHeader(event, 'idempotency-key'))
    || `people:employee:${uid}:disable-console-directory-user:v1`
  const detail = {
    sourceApp,
    reason: text(body.reason) || 'people_offboarding',
    operatorUid: text(body.operatorUid),
    leaveDate: text(body.leaveDate),
    idempotencyKey
  }
  const existingStatus = directoryStatusKey(existing.status)

  if (existingStatus !== 'inactive' && existingStatus !== 'deleted') {
    await updateDirectoryUser(uid, { status: 'inactive' }, actor.actorId || sourceApp, 'service')
  }

  const revoked = await revokeUserSessions(uid)
  const user = await getDirectoryUserForAdmin(uid)
  const currentStatus = directoryStatusKey(user?.status)

  await execute(
    `INSERT INTO operation_logs (
       domain_code, action, target_type, target_key, actor_type, actor_id, request_id, detail_json, created_at
     ) VALUES ('directory', 'directory.user.disable.from_people', 'directory_user', ?, 'service', ?, ?, CAST(? AS JSON), UTC_TIMESTAMP())`,
    [
      uid,
      actor.actorId || null,
      idempotencyKey,
      JSON.stringify({
        ...detail,
        previousStatus: existingStatus,
        currentStatus,
        revoked
      })
    ]
  )

  return {
    code: 0,
    message: 'ok',
    data: {
      uid,
      status: currentStatus,
      disabled: currentStatus === 'inactive',
      alreadyDisabled: existingStatus === 'inactive' || existingStatus === 'deleted',
      revoked,
      idempotencyKey
    }
  }
})
