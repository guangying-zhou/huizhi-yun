import { readBody } from 'h3'
import { requirePermission } from '~~/server/utils/checkPermission'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'
import { createVaultSecret, type CreateVaultSecretInput } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'credential_vault', 'edit')
  const body = await readBody<CreateVaultSecretInput>(event)
  const result = await createVaultSecret({
    ...body,
    createdBy: await requireConsoleRequestUid(event)
  }, event)
  return ok(result)
})
