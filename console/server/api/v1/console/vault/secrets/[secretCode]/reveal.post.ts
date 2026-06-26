import { createError, getRouterParam, readBody } from 'h3'
import { requirePermission } from '~~/server/utils/checkPermission'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'
import { revealVaultSecret } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'credential_vault', 'edit')
  const secretCode = getRouterParam(event, 'secretCode') || ''
  const body = await readBody<{
    versionNo?: number
    reason?: string
    approvalCode?: string
  }>(event)
  const reason = String(body.reason || '').trim()
  if (!reason) {
    throw createError({ statusCode: 400, message: 'reason is required' })
  }

  const uid = await requireConsoleRequestUid(event)
  const result = await revealVaultSecret({
    event,
    secretCode,
    versionNo: body.versionNo,
    actor: {
      actorType: 'human',
      actorId: uid,
      appCode: 'console'
    },
    reason,
    approvalCode: body.approvalCode || null
  })
  return ok(result)
})
