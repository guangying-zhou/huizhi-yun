import { getRouterParam, readBody } from 'h3'
import { requirePermission } from '~~/server/utils/checkPermission'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'
import { addVaultSecretVersion } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'credential_vault', 'edit')
  const secretCode = getRouterParam(event, 'secretCode') || ''
  const body = await readBody<{
    storageBackend?: unknown
    material?: { plaintext?: unknown, backendSecretRef?: unknown } | null
  }>(event)
  const result = await addVaultSecretVersion({
    secretCode,
    storageBackend: body.storageBackend,
    material: body.material,
    createdBy: await requireConsoleRequestUid(event),
    setCurrent: false,
    action: 'rotate'
  }, event)
  return ok(result)
})
