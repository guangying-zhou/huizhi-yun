import { createError, readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireVaultServiceActor, resolveVaultSecret } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  const actor = await requireVaultServiceActor(event)
  const body = await readBody<{
    secretCode?: string
    secretRef?: string
    versionNo?: number
    purpose?: string
  }>(event)
  const purpose = String(body.purpose || '').trim()
  if (!purpose) {
    throw createError({ statusCode: 400, message: 'purpose is required' })
  }

  return ok(await resolveVaultSecret({
    event,
    secretCode: body.secretCode || null,
    secretRef: body.secretRef || null,
    versionNo: body.versionNo || null,
    actor,
    purpose
  }))
})
