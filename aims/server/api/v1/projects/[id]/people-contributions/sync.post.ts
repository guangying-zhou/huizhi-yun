import { createError, defineEventHandler, readBody, setResponseStatus } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'
import { dispatchPeopleContributionOperation } from '~~/server/utils/serviceTicketDeliveryOperation'
import { requirePermission } from '~~/server/utils/checkPermission'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

type RequestBody = Record<string, unknown>

function text(value: unknown) {
  return String(value || '').trim()
}

function firstText(body: RequestBody, ...keys: string[]) {
  for (const key of keys) {
    const value = text(body[key])
    if (value) return value
  }
  return ''
}

function requireText(body: RequestBody, keys: string[], field: string) {
  const value = firstText(body, ...keys)
  if (!value) throw createError({ statusCode: 400, message: `${field} is required.` })
  return value
}

function dateValue(body: RequestBody, keys: string[], field: string) {
  const value = requireText(body, keys, field)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError({ statusCode: 400, message: `${field} must be YYYY-MM-DD.` })
  }
  return value
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })
  await requirePermission(event, 'projects', 'edit', '需要项目编辑权限才能同步 People 贡献快照')

  const projectID = text(event.context.params?.id)
  if (!projectID) throw createError({ statusCode: 400, message: 'project id is required.' })

  const body = ((await readBody<RequestBody>(event).catch(() => ({} as RequestBody))) || {}) as RequestBody
  const cycleCode = requireText(body, ['cycleCode', 'cycle_code'], 'cycleCode')
  const periodStart = dateValue(body, ['periodStart', 'period_start'], 'periodStart')
  const periodEnd = dateValue(body, ['periodEnd', 'period_end'], 'periodEnd')
  const query = await buildAimsProjectRuntimeAccessQuery(event, {
    projectId: projectID,
    uid,
    baseQuery: { operator_uid: uid }
  })
  const frozen = await maybeCallTenantRuntime<RuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/aims/service/projects/${encodeURIComponent(projectID)}/people-contributions:freeze`,
    {
      appCode: 'aims',
      scope: 'aims.write',
      method: 'POST',
      query,
      body: { cycleCode, periodStart, periodEnd, current_user: uid }
    }
  )
  if (!frozen.handled) {
    throw createError({ statusCode: 503, message: 'Aims tenant-runtime is required for contribution snapshot freeze.' })
  }
  if (frozen.data.code !== undefined && String(frozen.data.code) !== '0') {
    throw createError({ statusCode: 502, message: frozen.data.message || 'Aims contribution snapshot freeze failed.' })
  }
  const snapshot = frozen.data.data
  const operationKey = text(snapshot?.operationKey)
  if (!snapshot || !operationKey) {
    throw createError({ statusCode: 502, message: 'Aims contribution snapshot freeze returned no operation.' })
  }

  const peopleSync = text(snapshot.status) === 'succeeded'
    ? { linked: true, synced: true, pending: false, idempotent: true }
    : await dispatchPeopleContributionOperation(event, operationKey)
  if (!peopleSync.synced) setResponseStatus(event, 202)

  return {
    code: 0,
    data: {
      projectId: projectID,
      projectCode: snapshot.projectCode,
      periodStart,
      periodEnd,
      sourceRevision: snapshot.sourceRevision,
      snapshotHash: snapshot.snapshotHash,
      contributionItems: snapshot.itemCount,
      peopleSync
    }
  }
})
