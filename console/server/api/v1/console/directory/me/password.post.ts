import { readBody, setResponseStatus } from 'h3'
import { queueConsoleDirectoryPasswordChange } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'

export default defineEventHandler(async (event) => {
  await requireConsoleRequestUid(event)
  requireIdempotencyKey(event)
  const body = await readBody<Record<string, unknown>>(event)
  const operation = await queueConsoleDirectoryPasswordChange(event, body)
  setResponseStatus(event, 202)
  return operation
})
