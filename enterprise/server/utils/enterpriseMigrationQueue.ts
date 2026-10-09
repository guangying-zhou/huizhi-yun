import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { evaluateFoundationScopedAuthorization } from '@hzy/foundation/server/utils/scopeEvaluator'
import { buildAPFPermit } from './enterpriseAPF'

// Migration follow-up queue (W3). Reads only: each kind has a closed
// projection in Runtime, and the ledger row itself never reaches the Host.
export const migrationQueueKinds = {
  altoc: ['owner_unmatched', 'contact_without_customer', 'contact_orphan', 'contract_contact_mismatch', 'primary_contact_mismatch', 'effective_amount_exceeds_total', 'identity_source_missing'],
  finance: ['contract_balance_mismatch', 'balance_without_account', 'balance_latest_conflict']
} as const
export type MigrationQueueApp = keyof typeof migrationQueueKinds
export type MigrationQueueView = 'exceptions' | 'identities'
const statuses = { exceptions: ['open', 'resolved', 'accepted', 'superseded'], identities: ['candidate', 'confirmed', 'rejected', 'unmatched', 'source_missing'] }

export function normalizeMigrationQueueRequest(app: MigrationQueueApp, view: MigrationQueueView, query: Record<string, unknown>) {
  if (!Object.hasOwn(migrationQueueKinds, app) || (view === 'identities' && app !== 'altoc')) throw createError({ statusCode: 400 })
  const allowed = view === 'identities' ? ['page', 'pageSize', 'status', 'search'] : ['page', 'pageSize', 'status', 'search', 'kind', 'objectSearch', 'createdFrom', 'createdTo', 'sort', 'eventsFor', ...(app === 'finance' ? ['exceptionId'] : [])]
  if (Object.keys(query).some(key => !allowed.includes(key)) || Object.values(query).some(value => typeof value !== 'string' && typeof value !== 'number')) throw createError({ statusCode: 400 })
  const integer = (value: unknown, fallback: number, max: number) => {
    const n = value ?? fallback
    if (!/^[1-9]\d*$/.test(String(n)) || !Number.isSafeInteger(Number(n)) || Number(n) > max) throw createError({ statusCode: 400 })
    return Number(n)
  }
  const kind = String(query.kind || '')
  const rawStatuses = String(query.status || '').split(',').filter(Boolean)
  if (new Set(rawStatuses).size !== rawStatuses.length || rawStatuses.some(value => !statuses[view].includes(value))) throw createError({ statusCode: 400 })
  const status = rawStatuses.sort().join(',')
  const search = String(query.search || '')
  if (kind && !(migrationQueueKinds[app] as readonly string[]).includes(kind)) throw createError({ statusCode: 400 })

  // Free-text search exists only for unassigned contacts and for source people.
  if (search && ((view === 'exceptions' && kind !== 'contact_without_customer') || search !== search.trim() || [...search].length > 100)) throw createError({ statusCode: 400 })
  const exceptionId = String(query.exceptionId || '')
  if (exceptionId && (!/^[1-9]\d{0,15}$/.test(exceptionId) || !Number.isSafeInteger(Number(exceptionId)) || app !== 'finance' || kind !== 'balance_without_account' || status || search)) throw createError({ statusCode: 400 })
  const objectSearch = String(query.objectSearch || '')
  const createdFrom = String(query.createdFrom || ''), createdTo = String(query.createdTo || ''), sort = String(query.sort || '')
  const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
  if (objectSearch !== objectSearch.trim() || [...objectSearch].length > 100 || (createdFrom && !date(createdFrom)) || (createdTo && !date(createdTo)) || (createdFrom && createdTo && createdFrom > createdTo) || (sort && !['created_asc', 'created_desc'].includes(sort)) || (exceptionId && (objectSearch || createdFrom || createdTo || sort))) throw createError({ statusCode: 400 })
  const eventsFor = String(query.eventsFor || '')
  if (eventsFor && (!/^(exception:[1-9]\d{0,15}|identity:(employee|user):[0-9]{1,20})$/.test(eventsFor) || (app === 'finance' && !eventsFor.startsWith('exception:')) || status || search || objectSearch || createdFrom || createdTo || sort || kind)) throw createError({ statusCode: 400 })
  const migrationQuery = objectSearch || createdFrom || createdTo || sort || eventsFor ? { ...(eventsFor ? { eventsFor } : {}), ...(objectSearch ? { objectSearch } : {}), ...(createdFrom ? { createdFrom } : {}), ...(createdTo ? { createdTo } : {}), ...(sort ? { sort } : {}) } : undefined
  return { ...(migrationQuery ? { migrationQuery } : {}), id: exceptionId, code: kind, name: status, rowVersion: 0, page: integer(query.page, 1, 1_000_000), pageSize: integer(query.pageSize, 20, 100), search }
}

async function migrationQueue(event: H3Event, app: MigrationQueueApp, view: MigrationQueueView) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  const input = normalizeMigrationQueueRequest(app, view, getQuery(event))
  // Literal app and resource per branch, so the manifest inventory guard can verify each one.
  const scoped = app === 'altoc'
    ? await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'altoc', { resourceCode: 'migration_exceptions', action: 'view' })
    : await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'finance', { resourceCode: 'migration_exceptions', action: 'view' })
  if (scoped.uid !== user.uid || scoped.appCode !== app || !scoped.bundleVersion || !scoped.bundleHash || !Number.isSafeInteger(scoped.policyRevision)) throw createError({ statusCode: 503 })
  const allowed = app === 'altoc'
    ? evaluateFoundationScopedAuthorization({ grants: scoped.grants, required: { appCode: 'altoc', resourceCode: 'migration_exceptions', action: 'view' }, policyOf: () => scoped.actionPolicy }).allowed
    : evaluateFoundationScopedAuthorization({ grants: scoped.grants, required: { appCode: 'finance', resourceCode: 'migration_exceptions', action: 'view' }, policyOf: () => scoped.actionPolicy }).allowed
  if (!allowed) throw createError({ statusCode: 403 })
  const operation = view === 'identities' ? 'migration-identities-page' : 'migration-exceptions-page'
  const op = `${app}.w3-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt ?? 0)
  if (expiresAt <= Date.now()) throw createError({ statusCode: 503 })
  const authorization = { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'migration_exceptions', action: 'view', operation, objectId: input.id, allowed: true, expiresAt, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision, scope: { access: 'all', departmentCodes: [] } }
  const result = await callEnterpriseRuntime<{ code: number, data: { data?: unknown, total?: unknown, page?: unknown, pageSize?: unknown, openCounts?: unknown } }>(event, op, { ...input, authorization })
  const d = result.data
  if (result.code !== 0 || !d || !Array.isArray(d.data) || d.data.length > 100 || !Number.isSafeInteger(d.total) || Number(d.total) < d.data.length || d.page !== input.page || d.pageSize !== input.pageSize) throw createError({ statusCode: 503 })
  return view === 'identities' ? { data: d.data, total: d.total, page: d.page, pageSize: d.pageSize } : { data: d.data, total: d.total, page: d.page, pageSize: d.pageSize, openCounts: d.openCounts ?? {} }
}

export const enterpriseAltocMigrationExceptions = (event: H3Event) => migrationQueue(event, 'altoc', 'exceptions')
export const enterpriseAltocMigrationIdentities = (event: H3Event) => migrationQueue(event, 'altoc', 'identities')
export const enterpriseFinanceMigrationExceptions = (event: H3Event) => migrationQueue(event, 'finance', 'exceptions')

// Queue writes. Every command is closed: the browser names an item, a method
// and (for contacts) a customer; contact content is taken from the ledger by Runtime.
const resolveMethods = ['accept', 'reopen', 'mark_done', 'assign_customer', 'link_existing', 'record_balance'] as const
const validID = (v: unknown) => typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v)
const version = (v: unknown) => {
  if (!Number.isSafeInteger(v) || Number(v) < 1 || Number(v) > 4294967295) throw createError({ statusCode: 400 })
  return Number(v)
}
const text = (v: unknown, max: number) => {
  if (v === undefined || v === null || v === '') return ''
  // eslint-disable-next-line no-control-regex
  if (typeof v !== 'string' || v !== v.trim() || [...v].length > max || /[\u0000-\u001f\u007f]/.test(v)) throw createError({ statusCode: 400 })
  return v
}

export function normalizeMigrationResolve(app: MigrationQueueApp, id: string | undefined, query: Record<string, unknown>, body: unknown) {
  if (!Object.hasOwn(migrationQueueKinds, app) || !validID(id) || Object.keys(query).length || !body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400 })
  const raw = body as Record<string, unknown>
  if (Object.keys(raw).some(key => !['expectedVersion', 'method', 'reason', 'customerId', 'contactCode', 'accountCode', 'amount'].includes(key))) throw createError({ statusCode: 400 })
  const method = raw.method as typeof resolveMethods[number]
  if (!resolveMethods.includes(method)) throw createError({ statusCode: 400 })
  const contact = method === 'assign_customer' || method === 'link_existing'
  const customerId = raw.customerId === undefined ? '' : raw.customerId
  const contactCode = raw.contactCode === undefined ? '' : raw.contactCode
  if (contact !== Boolean(customerId) || (contact && (app !== 'altoc' || !validID(customerId)))) throw createError({ statusCode: 400 })
  if ((method === 'link_existing') !== Boolean(contactCode) || (contactCode && (typeof contactCode !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(contactCode)))) throw createError({ statusCode: 400 })
  const accountCode = raw.accountCode === undefined ? '' : raw.accountCode
  const amount = raw.amount === undefined ? '' : raw.amount
  if (method === 'record_balance') {
    // The amount must be one the item lists (Runtime checks that); here only its shape.
    if (app !== 'finance' || typeof amount !== 'string' || !/^-?(0|[1-9]\d{0,15})(\.\d{1,2})?$/.test(amount) || (accountCode && (typeof accountCode !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(accountCode)))) throw createError({ statusCode: 400 })
  } else if (accountCode || amount) throw createError({ statusCode: 400 })
  return { id: id as string, expectedVersion: version(raw.expectedVersion), method, reason: text(raw.reason, 500), customerId: customerId as string, contactCode: contactCode as string, accountCode: accountCode as string, amount: amount as string }
}

export function normalizeMigrationIdentityDecision(decision: 'confirm' | 'reject', sourceUserId: string | undefined, query: Record<string, unknown>, body: unknown) {
  if (!sourceUserId || !/^(employee|user):[0-9]{1,20}$/.test(sourceUserId) || Object.keys(query).length || !body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400 })
  const raw = body as Record<string, unknown>
  if (Object.keys(raw).some(key => !['expectedStatus', 'directoryUid'].includes(key))) throw createError({ statusCode: 400 })
  const expectedStatus = raw.expectedStatus
  if (typeof expectedStatus !== 'string' || !['candidate', 'unmatched', 'rejected', 'confirmed'].includes(expectedStatus)) throw createError({ statusCode: 400 })
  const directoryUid = raw.directoryUid === undefined ? '' : raw.directoryUid
  if (decision === 'confirm') {
    if (expectedStatus === 'confirmed' || typeof directoryUid !== 'string' || !/^[^\s:]{1,64}$/.test(directoryUid)) throw createError({ statusCode: 400 })
  } else if (directoryUid || expectedStatus === 'rejected') throw createError({ statusCode: 400 })
  return { sourceUserId, expectedStatus, directoryUid: directoryUid as string }
}

async function migrationWrite(event: H3Event, app: MigrationQueueApp, operation: 'migration-exceptions-resolve' | 'migration-identities-confirm' | 'migration-identities-reject' | 'migration-identities-apply', objectId: string, command: Record<string, unknown>) {
  const user = await requireEnterpriseUser(event)
  const key = getHeader(event, 'idempotency-key')
  if (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key)) throw createError({ statusCode: 400, message: 'Idempotency-Key is required.' })
  const scoped = app === 'altoc'
    ? await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'altoc', { resourceCode: 'migration_exceptions', action: 'resolve' })
    : await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'finance', { resourceCode: 'migration_exceptions', action: 'resolve' })
  if (scoped.uid !== user.uid || scoped.appCode !== app || !scoped.bundleVersion || !scoped.bundleHash || !Number.isSafeInteger(scoped.policyRevision)) throw createError({ statusCode: 503 })
  const allowed = app === 'altoc'
    ? evaluateFoundationScopedAuthorization({ grants: scoped.grants, required: { appCode: 'altoc', resourceCode: 'migration_exceptions', action: 'resolve' }, policyOf: () => scoped.actionPolicy }).allowed
    : evaluateFoundationScopedAuthorization({ grants: scoped.grants, required: { appCode: 'finance', resourceCode: 'migration_exceptions', action: 'resolve' }, policyOf: () => scoped.actionPolicy }).allowed
  if (!allowed) throw createError({ statusCode: 403 })
  return { user, key, scoped, objectId, operation, command }
}

async function migrationSend(event: H3Event, app: MigrationQueueApp, prepared: Awaited<ReturnType<typeof migrationWrite>>, field: 'migrationResolve' | 'migrationIdentity' | 'migrationApply') {
  const { user, key, scoped, objectId, operation, command } = prepared
  const op = `${app}.w3-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt ?? 0)
  if (expiresAt <= Date.now()) throw createError({ statusCode: 503 })
  const authorization = { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'migration_exceptions', action: 'resolve', operation, objectId, allowed: true, expiresAt, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision, scope: { access: 'all', departmentCodes: [] } }
  const result = await callEnterpriseRuntime<{ code: number, data: { data?: Record<string, unknown> } }>(event, op, { [field]: command, authorization }, { idempotencyKey: key })
  if (result.code !== 0 || !result.data?.data || typeof result.data.data !== 'object') throw createError({ statusCode: 503 })
  return { data: result.data.data }
}

async function migrationResolve(event: H3Event, app: MigrationQueueApp) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const command: Record<string, unknown> = normalizeMigrationResolve(app, getRouterParam(event, 'id'), getQuery(event), await readBody(event))
  const prepared = await migrationWrite(event, app, 'migration-exceptions-resolve', command.id as string, command)
  if (command.customerId) {
    // Touching a customer needs the caller's own customer:edit authorization as
    // well; its data scope travels inside the signed command.
    const customer = await buildAPFPermit(event, 'altoc', 'save', { id: '', code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }, prepared.user)
    command.customerScope = customer.scope
  }
  return migrationSend(event, app, prepared, 'migrationResolve')
}

async function migrationIdentityDecision(event: H3Event, decision: 'confirm' | 'reject') {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const command = normalizeMigrationIdentityDecision(decision, getRouterParam(event, 'sourceUserId'), getQuery(event), await readBody(event))
  const prepared = await migrationWrite(event, 'altoc', decision === 'confirm' ? 'migration-identities-confirm' : 'migration-identities-reject', command.sourceUserId, command)
  return migrationSend(event, 'altoc', prepared, 'migrationIdentity')
}

export const enterpriseAltocMigrationResolve = (event: H3Event) => migrationResolve(event, 'altoc')
export const enterpriseFinanceMigrationResolve = (event: H3Event) => migrationResolve(event, 'finance')
export const enterpriseAltocMigrationIdentityConfirm = (event: H3Event) => migrationIdentityDecision(event, 'confirm')
export const enterpriseAltocMigrationIdentityReject = (event: H3Event) => migrationIdentityDecision(event, 'reject')

// Hand the open items of a confirmed source person to the matched user. Each
// item goes through the normal owner-change command, so the caller's own
// customer:edit and contract:edit scopes travel inside the signed command.
export function normalizeMigrationApply(sourceUserId: string | undefined, query: Record<string, unknown>, body: unknown) {
  if (!sourceUserId || !/^employee:[0-9]{1,20}$/.test(sourceUserId) || Object.keys(query).length || !body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400 })
  const raw = body as Record<string, unknown>
  if (Object.keys(raw).some(key => key !== 'limit')) throw createError({ statusCode: 400 })
  const limit = raw.limit === undefined ? 100 : raw.limit
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw createError({ statusCode: 400 })
  return { sourceUserId, limit: Number(limit) }
}

export async function enterpriseAltocMigrationIdentityApply(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const command: Record<string, unknown> = normalizeMigrationApply(getRouterParam(event, 'sourceUserId'), getQuery(event), await readBody(event))
  const prepared = await migrationWrite(event, 'altoc', 'migration-identities-apply', command.sourceUserId as string, command)
  const empty = { id: '', code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }
  command.customerScope = (await buildAPFPermit(event, 'altoc', 'save', empty, prepared.user)).scope
  command.contractScope = (await buildAPFPermit(event, 'altoc', 'save', empty, prepared.user, 'contract')).scope
  return migrationSend(event, 'altoc', prepared, 'migrationApply')
}
