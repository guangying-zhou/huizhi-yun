import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callDirectoryServiceCommand, callDirectoryEmploymentStatus, type FrozenDirectoryCommand } from '@hzy/foundation/server/utils/directoryServiceCommand'
import type { PeopleFactsOperation, PeopleFactsInput } from '@hzy/foundation/server/utils/enterprisePeopleFactsPermit'
import { executePeopleFacts } from './enterprisePeopleFacts'

export type PeopleProvisioningAction = 'provision' | 'refresh-status' | 'activation-link' | 'activate' | 'cancel'
const targetStatuses = ['pending', 'processing', 'retry_wait', 'partial_unknown', 'succeeded', 'failed_permanent', 'dead_letter']
export function provisioningDiagnostic(provisionStatus: unknown, lifecycle?: Record<string, unknown>) {
  if (!targetStatuses.includes(String(provisionStatus))) throw createError({ statusCode: 502, statusMessage: 'people_target_status_invalid' })
  const platform = String(lifecycle?.platformStatus || '')
  if (platform && !targetStatuses.includes(platform)) throw createError({ statusCode: 502, statusMessage: 'people_target_status_invalid' })
  if (lifecycle && typeof lifecycle.directoryApplied !== 'boolean') throw createError({ statusCode: 502, statusMessage: 'people_target_status_invalid' })
  return { provisionStatus: String(provisionStatus), directoryStatus: lifecycle ? lifecycle.directoryApplied ? 'succeeded' : 'pending' : 'unknown', platformStatus: platform || 'unknown' }
}
const manualMessage = '手工候选暂不支持自动开通，请在 Console 中处理'
export function normalizePeopleProvisioningBrowser(action: PeopleProvisioningAction, id: string, raw: unknown) {
  if (!['provision', 'refresh-status', 'activation-link', 'activate', 'cancel'].includes(action) || !/^[1-9]\d{0,15}$/.test(id) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400 })
  const body = raw as Record<string, unknown>
  if (Object.keys(body).some(k => !['expectedVersion', ...action === 'cancel' ? ['reason'] : []].includes(k)) || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1 || Number(body.expectedVersion) > 4294967295 || (action === 'cancel' && (typeof body.reason !== 'string' || body.reason.trim() !== body.reason || body.reason.length < 5 || body.reason.length > 200))) throw createError({ statusCode: 400 })
  return { expectedVersion: Number(body.expectedVersion), reason: String(body.reason || '') }
}
export function requireAutomaticCandidate(row: Record<string, unknown>) {
  if (row.provider_code !== 'dingtalk') throw createError({ statusCode: 409, statusMessage: 'people_manual_onboarding_unsupported', message: manualMessage })
}
export async function enterprisePeopleProvisioning(event: H3Event, action: PeopleProvisioningAction) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const id = getRouterParam(event, 'id') || ''
  const input = normalizePeopleProvisioningBrowser(action, id, await readBody(event))
  const key = getHeader(event, 'idempotency-key') || ''
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(key)) throw createError({ statusCode: 400 })
  const call = async (operation: PeopleFactsOperation, payload: Record<string, unknown>, suffix: string) => {
    const facts: PeopleFactsInput = { id, employeeUid: '', page: 0, pageSize: 0, search: '', payload, sensitiveAllowed: false }
    const out = await executePeopleFacts(event, operation, facts, operation === 'onboarding-view' ? undefined : `${key}:${suffix}`)
    return out.data.data
  }
  const row = await call('onboarding-view', {}, 'read')
  requireAutomaticCandidate(row)
  const version = input.expectedVersion
  const prepare = async (kind: 'reserve' | 'release' | 'provision' | 'status' | 'activation-link', expectedVersion: number) => {
    const prepared = await call(`onboarding-prepare-${kind}`, { expectedVersion }, `prepare-${kind}`)
    const frozen = prepared.frozen as FrozenDirectoryCommand | undefined
    if (!frozen || frozen.sourceApp !== 'enterprise' || !frozen.command || String(frozen.command.onboardingCode) !== String(row.onboarding_code)) throw createError({ statusCode: 503 })
    return frozen
  }
  const target = async (frozen: FrozenDirectoryCommand): Promise<Record<string, unknown>> => {
    const reply = await callDirectoryServiceCommand(event, frozen)
    const uid = String(frozen.command.uid)
    if (reply.uid !== undefined && reply.uid !== uid) throw createError({ statusCode: 409, statusMessage: 'people_target_confirmation_invalid' })
    return { uid, ...Object.fromEntries(['reservationId', 'operationId', 'status', 'released', 'errorCode'].filter(k => typeof reply[k] === 'string' || typeof reply[k] === 'boolean').map(k => [k, reply[k]])) }
  }
  const confirm = async (operation: PeopleFactsOperation, frozen: FrozenDirectoryCommand, expectedVersion: number, confirmation: Record<string, unknown>) => await call(operation, { expectedVersion, operationKey: frozen.operationKey, confirmation, ...operation === 'onboarding-cancel' ? { reason: input.reason } : {} }, operation)
  if (action === 'provision') {
    // Version offsets belong to the original browser intent, not whatever row
    // version a partially successful retry happens to observe. Every checkpoint
    // can replay the same signed payload and immutable receipt.
    await call('onboarding-begin-provisioning', { expectedVersion: version }, 'begin')
    const reserve = await prepare('reserve', version + 1)
    const reserved = await target(reserve)
    if (typeof reserved.reservationId !== 'string' || !reserved.reservationId) throw createError({ statusCode: 502 })
    await confirm('onboarding-reserved', reserve, version + 1, reserved)
    const provision = await prepare('provision', version + 2)
    const provisioning = await target(provision)
    if (typeof provisioning.operationId !== 'string' || !provisioning.operationId) throw createError({ statusCode: 502 })
    const done = await confirm('onboarding-provisioning', provision, version + 2, provisioning)
    return { code: 0, data: { status: done.status, objectVersion: done.object_version } }
  }
  if (action === 'cancel') {
    if (!Number(row.has_reservation)) {
      const done = await call('onboarding-cancel', { expectedVersion: version, reason: input.reason }, 'cancel')
      return { code: 0, data: { status: done.status, objectVersion: done.object_version } }
    }
    const release = await prepare('release', version)
    const released = await target(release)
    if (released.reservationId !== release.command.reservationId || released.released !== true) throw createError({ statusCode: 409 })
    const done = await confirm('onboarding-cancel', release, version, { ...released, released: true })
    return { code: 0, data: { status: done.status, objectVersion: done.object_version } }
  }
  if (action === 'activation-link') {
    const frozen = await prepare('activation-link', version)
    const response = await callDirectoryServiceCommand(event, frozen)
    return { code: 0, data: { activationDelivered: response.activationDelivered === true, activationExpiresAt: typeof response.activationExpiresAt === 'string' ? response.activationExpiresAt : null } }
  }
  const frozen = await prepare('status', version)
  const result = await target(frozen)
  if (result.operationId !== frozen.command.provisionOperationId || !['pending', 'processing', 'retry_wait', 'partial_unknown', 'succeeded', 'failed_permanent', 'dead_letter'].includes(String(result.status))) throw createError({ statusCode: 409 })
  const diagnostic = provisioningDiagnostic(result.status)
  if (result.status !== 'succeeded') return { code: 0, data: { status: String(row.status), ...diagnostic } }
  if (row.status === 'provisioning_account') {
    const done = await confirm('onboarding-activate', frozen, version, result)
    return { code: 0, data: { status: done.status, objectVersion: done.object_version, ...diagnostic } }
  }
  if (['activating_employee', 'projecting_authorization', 'authorization_failed'].includes(String(row.status))) {
    const lifecycle = await callDirectoryEmploymentStatus(event, frozen)
    const lifecycleDiagnostic = provisioningDiagnostic(result.status, lifecycle)
    const done = await confirm('onboarding-aggregate-status', frozen, version, { ...result, directoryApplied: lifecycle.directoryApplied === true, platformStatus: String(lifecycle.platformStatus || '') })
    return { code: 0, data: { status: done.status, objectVersion: done.object_version, ...lifecycleDiagnostic } }
  }
  return { code: 0, data: { status: String(row.status), ...diagnostic } }
}
