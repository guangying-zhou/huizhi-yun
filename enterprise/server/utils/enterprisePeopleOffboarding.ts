import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { peopleFactsOperations, type PeopleFactsInput, type PeopleFactsOperation } from '@hzy/foundation/server/utils/enterprisePeopleFactsPermit'
import { executePeopleFacts } from './enterprisePeopleFacts'

export function normalizeOffboarding(operation: PeopleFactsOperation, id: string, raw: Record<string, unknown>): PeopleFactsInput {
  const list = operation === 'offboarding-list'
  const read = list || operation === 'offboarding-view'
  const create = operation === 'offboarding-create'
  const allowed = list ? ['page', 'pageSize', 'search'] : read ? [] : create ? ['employeeUid', 'leaveAssignmentCode'] : operation === 'offboarding-arrange' ? ['employeeUid', 'expectedVersion', 'handoverResponsibleUid', 'handoverDueAt', 'assetRecoveryResponsibleUid', 'assetRecoveryDueAt'] : ['employeeUid', 'expectedVersion', 'taskType', ...operation === 'offboarding-cancel' ? ['reason'] : []]
  if (!Object.hasOwn(peopleFactsOperations, operation) || !operation.startsWith('offboarding-') || Object.keys(raw).some(k => !allowed.includes(k)) || (list || create ? !!id : !/^[1-9]\d{0,15}$/.test(id))) throw createError({ statusCode: 400 })
  const integer = (v: unknown, fallback: number, max: number) => {
    const n = Number(v ?? fallback)
    if (!Number.isSafeInteger(n) || n < 1 || n > max) throw createError({ statusCode: 400 })
    return n
  }
  const employeeUid = read ? '' : String(raw.employeeUid || '')
  if (!read && (!/^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/.test(employeeUid) || /^dt-/i.test(employeeUid))) throw createError({ statusCode: 400 })
  const payload = read ? {} : Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'employeeUid'))
  if (!read && !create) payload.expectedVersion = integer(raw.expectedVersion, 0, 4294967295)
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'expectedVersion') continue
    if (typeof v !== 'string' || v.trim() !== v || !v || [...v].length > 500 || [...v].some(c => [0, 10, 13].includes(c.charCodeAt(0)))) throw createError({ statusCode: 400 })
  }
  if (list && (typeof (raw.search ?? '') !== 'string' || String(raw.search ?? '').length > 100)) throw createError({ statusCode: 400 })
  return { id, employeeUid, page: list ? integer(raw.page, 1, 1_000_000) : 0, pageSize: list ? integer(raw.pageSize, 20, 100) : 0, search: list ? String(raw.search || '') : '', payload, sensitiveAllowed: false }
}

export async function enterprisePeopleOffboarding(event: H3Event, operation: PeopleFactsOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const read = ['offboarding-list', 'offboarding-view'].includes(operation)
  if (!read && Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const raw = read ? getQuery(event) : await readBody<Record<string, unknown>>(event)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400 })
  const facts = normalizeOffboarding(operation, getRouterParam(event, 'id') || '', raw)
  const result = await executePeopleFacts(event, operation, facts, read ? undefined : getHeader(event, 'idempotency-key'))
  if (read) return result
  const row = result.data.data
  return { code: 0, data: { data: { id: row.id, row_version: row.row_version }, receiptId: result.data.receiptId } }
}
