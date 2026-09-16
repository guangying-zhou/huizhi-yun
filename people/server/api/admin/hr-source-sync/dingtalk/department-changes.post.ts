import { randomUUID } from 'node:crypto'
import { getHeader, readBody } from 'h3'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { applyDingTalkDepartmentChanges } from '~~/server/utils/dingTalkHRSource'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'

export default defineEventHandler(async (event) => {
  await assertPeoplePermission(event, 'hr_source_sync', 'admin')
  const actorUid = getRequestUid(event)
  if (!actorUid) throw createError({ statusCode: 401, message: 'People HR source department decision requires login.' })
  const body = await readBody<{ snapshotRunId?: unknown, snapshotHash?: unknown, departmentCodes?: unknown }>(event)
  const snapshotRunId = Number(body.snapshotRunId)
  const snapshotHash = String(body.snapshotHash || '').trim().toLowerCase()
  const departmentCodes = Array.isArray(body.departmentCodes)
    ? body.departmentCodes.map(value => String(value || '').trim())
    : []
  if (
    !Number.isSafeInteger(snapshotRunId) || snapshotRunId < 1
    || !/^[a-f0-9]{64}$/.test(snapshotHash)
    || departmentCodes.length < 1 || departmentCodes.length > 500
    || departmentCodes.some(code => !code || code.length > 64)
    || new Set(departmentCodes).size !== departmentCodes.length
  ) {
    throw createError({ statusCode: 400, message: 'DingTalk department snapshot decision is invalid.' })
  }
  const idempotencyKey = String(getHeader(event, 'idempotency-key') || `people-dingtalk-dept-changes-${randomUUID()}`).trim()
  return await applyDingTalkDepartmentChanges(
    event,
    actorUid,
    snapshotRunId,
    snapshotHash,
    departmentCodes,
    idempotencyKey
  )
})
