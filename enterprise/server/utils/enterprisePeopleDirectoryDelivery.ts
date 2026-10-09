import { createError, type H3Event } from 'h3'
import { callEnterprisePeopleDirectoryWorker } from '@hzy/foundation/server/utils/enterpriseRuntimeChannels'
import { callDirectoryServiceCommand, type FrozenDirectoryCommand } from '@hzy/foundation/server/utils/directoryServiceCommand'
import { validateServiceCommandReceipt } from '@hzy/foundation/server/utils/serviceOperation'

// Bounded, explicitly authenticated wake only. No timer or environment flag is
// installed here; enabling the owner and verifying grants is a release gate.
export async function drainEnterprisePeopleDirectory(event: H3Event) {
  const began = Date.now()
  let cursor = ''
  let prepared = 0
  for (let page = 0; page < 1 && Date.now() - began < 15_000; page++) {
    const out = await callEnterprisePeopleDirectoryWorker<{ code: number, data: { prepared: number, cursor: string, hasMore: boolean } }>(event, 'prepare-due', { cursor })
    if (out.code !== 0 || !out.data || !Number.isSafeInteger(out.data.prepared)) throw createError({ statusCode: 503 })
    prepared += out.data.prepared
    cursor = out.data.cursor
    if (!out.data.hasMore) break
  }
  let claimed = 0
  let delivered = 0
  let failed = 0
  while (claimed < 1 && Date.now() - began < 25_000) {
    const out = await callEnterprisePeopleDirectoryWorker<{ code: number, data: { operation: (FrozenDirectoryCommand & { fencingToken: number }) | null } }>(event, 'claim', {})
    if (out.code !== 0 || !out.data) throw createError({ statusCode: 503 })
    const operation = out.data.operation
    if (!operation) break
    claimed++
    const observed = { operationId: operation.operationId, fencingToken: operation.fencingToken }
    let confirmed: { receipt: ReturnType<typeof validateServiceCommandReceipt>, platformStatus: string }
    try {
      const reply = await callDirectoryServiceCommand(event, operation)
      const receipt = validateServiceCommandReceipt(operation, reply, { targetBizType: 'directory_user', targetBizCode: String(operation.command.employeeUid) })
      const result = reply.result as Record<string, unknown> | undefined
      confirmed = { receipt, platformStatus: String(result?.platformStatus || '') }
    } catch (error) {
      const status = Number((error as { statusCode?: number, status?: number }).statusCode || (error as { status?: number }).status || 503)
      const fail = await callEnterprisePeopleDirectoryWorker<{ code: number }>(event, 'fail', { ...observed, httpStatus: status >= 400 && status <= 599 ? status : 503 })
      if (fail.code !== 0) throw createError({ statusCode: 503 })
      failed++
      continue
    }
    // Ack failure is not target failure. Preserve the successful target receipt;
    // lease recovery retries the original key against Console's idempotent core.
    // Platform pending belongs to Console's next hop and does not retry delivery.
    const { receipt, platformStatus } = confirmed
    const ack = await callEnterprisePeopleDirectoryWorker<{ code: number }>(event, 'ack', { ...observed, receipt: { ...receipt, platformStatus } })
    if (ack.code !== 0) throw createError({ statusCode: 503, statusMessage: 'people_checkpoint_unavailable' })
    delivered++
  }
  return { prepared, claimed, delivered, failed, hasMorePreparation: Boolean(cursor) }
}
