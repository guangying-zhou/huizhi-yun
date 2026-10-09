import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { requireEnterpriseUser, callEnterpriseRuntime, prepareEnterpriseRuntime, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { projectPeopleReadScope } from '@hzy/foundation/server/utils/peopleScopeProjection'
import { peopleFactsOperations, type PeopleFactsOperation } from '@hzy/foundation/server/utils/enterprisePeopleFactsPermit'
import { callHRSourceCommand, readHRSource, hrSourceTargets, type HRSourceKind } from '@hzy/foundation/server/utils/enterpriseHRSourceCommand'
import type { FrozenDirectoryCommand } from '@hzy/foundation/server/utils/directoryServiceCommand'

async function authorizeHR(event: H3Event, action: string) {
  const user = await requireEnterpriseUser(event)
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'people', { resourceCode: 'hr_source_sync', action })
  if (scoped.uid !== user.uid || scoped.appCode !== 'people' || !scoped.bundleVersion || !scoped.bundleHash || !Number.isSafeInteger(scoped.policyRevision)) throw createError({ statusCode: 503 })
  const scope = projectPeopleReadScope({ grants: scoped.grants, required: { appCode: 'people', resourceCode: 'hr_source_sync', action }, policyOf: () => scoped.actionPolicy }, user.uid, [])
  if (!scope) throw createError({ statusCode: 503 })
  if (scope.access !== 'all' || scope.departmentCodes.length) throw createError({ statusCode: 403 })
  return { user, scoped, scope }
}
async function runtimeHR(event: H3Event, operation: PeopleFactsOperation, payload: Record<string, unknown>, key?: string) {
  const [, action] = peopleFactsOperations[operation]
  const { user, scoped, scope } = await authorizeHR(event, action)
  const op = `people.apf09c1-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt ?? 0)
  if (expiresAt <= Date.now()) throw createError({ statusCode: 503 })
  const authorization = { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'hr_source_sync', action, operation, objectId: 'dingtalk|', allowed: true, expiresAt, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision, scope }
  const result = await callEnterpriseRuntime<{ code: number, data: { data: Record<string, unknown> } }>(event, op, { authorization, peopleFacts: { id: 'dingtalk', employeeUid: '', page: 0, pageSize: 0, search: '', payload, sensitiveAllowed: false } }, { idempotencyKey: key })
  if (result.code !== 0 || !result.data?.data) throw createError({ statusCode: 503 })
  return result.data.data
}
export async function enterprisePeopleHRRead(event: H3Event, kind: 'state' | 'mappings' | 'changes' | 'job') {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const state = await runtimeHR(event, 'hr-state', {})
  if (kind === 'state') return { code: 0, data: state }
  const user = await requireEnterpriseUser(event)
  return readHRSource(event, kind, user.tenant, user.deployment, getRouterParam(event, 'jobId'))
}
export async function enterprisePeopleHRWrite(event: H3Event, kind: HRSourceKind) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const raw = await readBody<Record<string, unknown>>(event)
  const key = getHeader(event, 'idempotency-key') || ''
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(key) || !raw || Array.isArray(raw) || Object.keys(raw).some(k => !['expectedVersion', 'command'].includes(k))) throw createError({ statusCode: 400 })
  if (kind === 'jobs-start') {
    const { user } = await authorizeHR(event, 'execute')
    const response = await readHRSource(event, 'mappings', user.tenant, user.deployment)
    const totals = (response.data as { totals?: Record<string, unknown> })?.totals
    const counts = ['total', 'mapped', 'suggested', 'conflict', 'unmatched'].map(k => Number(totals?.[k]))
    if (counts.some(n => !Number.isSafeInteger(n) || n < 0) || counts[0] !== Number(counts[1]) + Number(counts[2]) + Number(counts[3]) + Number(counts[4])) throw createError({ statusCode: 503 })
    raw.sourceReady = counts[0] === counts[1]
  }
  const prepared = await runtimeHR(event, `hr-${kind}-prepare` as PeopleFactsOperation, raw, key)
  const frozen = prepared.frozen as FrozenDirectoryCommand
  if (!frozen || frozen.operationCode !== hrSourceTargets[kind][1]) throw createError({ statusCode: 502 })
  // Restored intents always replay the original target command and key. No new
  // command is derived from a newer mapping snapshot after uncertain delivery.
  const target = await callHRSourceCommand(event, kind, frozen)
  const aliases = kind === 'mappings' ? target.aliases : []
  if (!Array.isArray(aliases)) throw createError({ statusCode: 502 })
  const confirmed = await runtimeHR(event, `hr-${kind}-confirm` as PeopleFactsOperation, { operationKey: prepared.operationKey, confirmation: { targetConfirmed: true, commandSha256: frozen.commandSha256, aliases } }, `${key}:confirmed`)
  return { code: 0, data: { status: confirmed.status, operationKey: confirmed.operationKey, target: Object.fromEntries(['jobId', 'status', 'applied'].filter(k => k in target).map(k => [k, target[k]])) } }
}
