import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callDirectoryLifecycleProbe, type FrozenDirectoryCommand } from '@hzy/foundation/server/utils/directoryServiceCommand'
import type { PeopleFactsInput } from '@hzy/foundation/server/utils/enterprisePeopleFactsPermit'
import { executePeopleFacts } from './enterprisePeopleFacts'

export function normalizeDirectoryRecovery(action: 'list' | 'view' | 'probe' | 'replay', id: string, raw: Record<string, unknown>): PeopleFactsInput {
  const allowed = action === 'list' ? ['page', 'pageSize'] : action === 'replay' ? ['expectedVersion', 'reason'] : []
  if (!raw || Array.isArray(raw) || Object.keys(raw).some(k => !allowed.includes(k)) || (action === 'list' ? !!id : !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))) throw createError({ statusCode: 400 })
  const integer = (v: unknown, fallback: number, max: number) => {
    const n = Number(v ?? fallback)
    if (!Number.isSafeInteger(n) || n < 1 || n > max) throw createError({ statusCode: 400 })
    return n
  }
  const payload = action === 'replay' ? { expectedVersion: integer(raw.expectedVersion, 0, 4294967295), reason: String(raw.reason || '') } : {}
  if (action === 'replay' && (typeof raw.reason !== 'string' || raw.reason.trim() !== raw.reason || [...raw.reason].length < 5 || [...raw.reason].length > 200 || [...raw.reason].some(c => [0, 10, 13].includes(c.charCodeAt(0))))) throw createError({ statusCode: 400 })
  return { id, employeeUid: '', page: action === 'list' ? integer(raw.page, 1, 1000000) : 0, pageSize: action === 'list' ? integer(raw.pageSize, 20, 100) : 0, search: '', payload, sensitiveAllowed: false }
}
export async function enterprisePeopleDirectoryRecovery(event: H3Event, action: 'list' | 'view' | 'probe' | 'replay') {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (action === 'replay' && Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const facts = normalizeDirectoryRecovery(action, getRouterParam(event, 'id') || '', action === 'replay' ? await readBody(event) : getQuery(event))
  const key = action === 'replay' ? getHeader(event, 'idempotency-key') : undefined
  const out = await executePeopleFacts(event, `directory-operations-${action === 'probe' ? 'view' : action}`, facts, key)
  // Command and hashes remain server-side. Browser sees counts/statuses only.
  if (action !== 'probe') return { code: 0, data: out.data.data, ...action === 'list' ? { total: (out.data as Record<string, unknown>).total } : {} }
  const frozen = (out.data as { frozen?: FrozenDirectoryCommand }).frozen
  if (!frozen) throw createError({ statusCode: 503 })
  const status = await callDirectoryLifecycleProbe(event, frozen)
  return { code: 0, data: { operationId: facts.id, ...status } }
}
