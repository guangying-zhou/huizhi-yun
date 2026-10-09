import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { requireEnterpriseUser, prepareEnterpriseRuntime, callEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadProjectCommandAuthorization } from '@hzy/foundation/server/utils/projectCommandAuthorization'
import { projectAltocReadData } from './enterpriseAltocReads'
import { buildAPFPermit } from './enterpriseAPF'

export const contractOperations = ['contracts-create', 'contracts-from-quotation', 'contracts-update', 'contract-lines-replace', 'payment-terms-replace', 'obligations-replace', 'obligations-transition', 'billing-schedules-list', 'contracts-sign', 'contracts-activate', 'contract-projects-bind', 'contract-projects-list', 'contracts-annotate', 'contracts-complete', 'contracts-terminate', 'contracts-set-owner'] as const
export type ContractOperation = typeof contractOperations[number]
const validID = (v: string) => /^[1-9]\d{0,15}$/.test(v) && Number.isSafeInteger(Number(v))
export function normalizeContractRequest(operation: ContractOperation, id: string, raw: Record<string, unknown>) {
  const create = ['contracts-create', 'contracts-from-quotation'].includes(operation)
  const read = ['billing-schedules-list', 'contract-projects-list'].includes(operation)
  if (create ? Boolean(id) : !validID(id)) throw createError({ statusCode: 400 })
  const header = ['name', 'contract_no', 'sign_date', 'effective_date', 'end_date', 'content_summary', 'remark']
  const allowed = read ? ['page', 'pageSize'] : operation === 'contracts-create' ? [...header, 'customerId', 'currency_code', 'direction'] : operation === 'contracts-from-quotation' ? [...header, 'quotationId', 'direction'] : operation === 'contracts-update' ? [...header, 'expectedVersion'] : ['expectedVersion', ...(['contract-lines-replace', 'payment-terms-replace', 'obligations-replace'].includes(operation) ? ['rows'] : operation === 'obligations-transition' ? ['action', 'reason', 'obligationCode'] : operation === 'contracts-annotate' ? ['contact_id', 'remark', 'content_summary'] : operation === 'contracts-set-owner' ? ['owner_uid', 'owner_dept_code'] : ['contracts-complete', 'contracts-terminate'].includes(operation) ? ['reason'] : ['contracts-activate', 'contract-projects-bind'].includes(operation) ? ['projects'] : [])]
  if (Object.keys(raw).some(k => !allowed.includes(k))) throw createError({ statusCode: 400 })
  const integer = (v: unknown, fallback: number, max: number) => {
    const n = v ?? fallback
    if (!/^[1-9]\d*$/.test(String(n)) || !Number.isSafeInteger(Number(n)) || Number(n) > max) throw createError({ statusCode: 400 })
    return Number(n)
  }
  const customerId = operation === 'contracts-create' ? String(raw.customerId || '') : ''
  const quotationId = operation === 'contracts-from-quotation' ? String(raw.quotationId || '') : ''
  if ((customerId && !validID(customerId)) || (quotationId && !validID(quotationId))) throw createError({ statusCode: 400 })
  const payload = Object.fromEntries(Object.entries(raw).filter(([k]) => !['customerId', 'quotationId', 'rows', 'projects', 'page', 'pageSize'].includes(k)))
  if (!read && !create) payload.expectedVersion = integer(raw.expectedVersion, 0, 4294967295)
  const rows = raw.rows ?? []
  if (!Array.isArray(rows) || rows.length > 500 || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) throw createError({ statusCode: 400 })
  const projects = raw.projects ?? []
  if (!Array.isArray(projects) || projects.length > 50) throw createError({ statusCode: 400 })
  const normalized = projects.map((p) => {
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !['projectCode', 'name', 'deptCode', 'create', 'lineCodes', 'obligationCodes', 'billingScheduleCodes'].includes(k)) || typeof p.create !== 'boolean' || !/^[A-Z0-9][A-Z0-9-]{0,49}$/.test(p.projectCode) || /\.\./.test(p.projectCode) || typeof p.name !== 'string' || typeof p.deptCode !== 'string') throw createError({ statusCode: 400 })
    const codes = (v: unknown) => {
      if (!Array.isArray(v) || v.length > 500 || v.some(c => typeof c !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(c)) || new Set(v).size !== v.length) throw createError({ statusCode: 400 })
      return v as string[]
    }
    return { projectCode: p.projectCode as string, name: p.name as string, deptCode: p.deptCode as string, create: p.create as boolean, lineCodes: codes(p.lineCodes), obligationCodes: codes(p.obligationCodes), billingScheduleCodes: codes(p.billingScheduleCodes) }
  })
  return { id, customerId, quotationId, page: read ? integer(raw.page, 1, 1_000_000) : 0, pageSize: read ? integer(raw.pageSize, 20, 100) : 0, payload, rows, projects: normalized, aimsPermits: [] as Record<string, unknown>[] }
}
export async function enterpriseAltocContract(event: H3Event, operation: ContractOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  const read = ['billing-schedules-list', 'contract-projects-list'].includes(operation)
  const raw = read ? getQuery(event) : await readBody<Record<string, unknown>>(event)
  if (!contractOperations.includes(operation) || !raw || typeof raw !== 'object' || Array.isArray(raw) || (!read && Object.keys(getQuery(event)).length)) throw createError({ statusCode: 400 })
  const contract = normalizeContractRequest(operation, getRouterParam(event, 'contractId') || '', raw)
  const key = read ? undefined : getHeader(event, 'idempotency-key')
  if (!read && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400 })
  const op = `altoc.wp4c-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  for (const p of contract.projects) {
    const permits = [await loadProjectCommandAuthorization(event, user, { resource: 'projects', action: p.create ? 'create' : 'edit', projectId: '', workItemId: '', projectCode: p.projectCode, deptCode: p.deptCode })]
    if (p.create && p.billingScheduleCodes.length) permits.push(await loadProjectCommandAuthorization(event, user, { resource: 'projects', action: 'edit', projectId: '', workItemId: '', projectCode: p.projectCode, deptCode: p.deptCode }))
    for (const a of permits) {
      contract.aimsPermits.push(Object.fromEntries(['actorUid', 'tenant', 'deployment', 'resource', 'action', 'allowed', 'expiresAt', 'bundleVersion', 'bundleHash', 'policyRevision', 'scope'].map(k => [k, a[k as keyof typeof a]]).concat([['projectCode', p.projectCode]])))
    }
  }
  const input = { id: `${contract.id}|${contract.customerId}|${contract.quotationId}`, code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }
  // Completing or terminating needs an explicit contract:close grant; the
  // override makes even the global admin role present one.
  const close = ['contracts-complete', 'contracts-terminate'].includes(operation)
  const authorization = { ...await buildAPFPermit(event, 'altoc', read ? 'view' : 'save', input, user, 'contract', close ? 'close' : undefined), operation }
  const result = await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, op, { contract, authorization }, { idempotencyKey: key })
  if (result.code !== 0 || !result.data) throw createError({ statusCode: 503 })
  if (!read) return { data: projectAltocReadData(result.data.data, 'contract', true) }
  const fields = operation === 'billing-schedules-list' ? 'billing_schedules' : 'project_links'
  const { altocContractChildFields } = await import('../../shared/altoc-basic-read')
  const d = result.data
  if (!Array.isArray(d.data) || d.data.length > 100 || !Number.isSafeInteger(d.total) || Number(d.total) < d.data.length || d.page !== contract.page || d.pageSize !== contract.pageSize) throw createError({ statusCode: 503 })
  return { data: d.data.map((row) => {
    if (!row || typeof row !== 'object' || String(row.contract_id) !== contract.id) throw createError({ statusCode: 503 })
    return Object.fromEntries(altocContractChildFields[fields].filter(k => k in row).map(k => [k, row[k]]))
  }), total: d.total, page: d.page, pageSize: d.pageSize }
}
