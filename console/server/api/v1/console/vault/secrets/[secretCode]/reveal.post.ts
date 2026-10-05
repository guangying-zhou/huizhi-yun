import { createError, getRouterParam, readBody, setHeader } from 'h3'
import { revealConsoleVaultSecret } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'credential_vault', 'admin')
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

  setHeader(event, 'Cache-Control', 'no-store, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  return await revealConsoleVaultSecret(event, secretCode, {
    versionNo: body.versionNo,
    reason,
    approvalCode: body.approvalCode || null
  })
})
