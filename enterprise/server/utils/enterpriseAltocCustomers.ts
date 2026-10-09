import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { requireEnterpriseUser, prepareEnterpriseRuntime, callEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { buildAPFPermit } from './enterpriseAPF'

export const customerOperations = ['customers-create', 'customers-update', 'customers-set-owner', 'customers-set-parent', 'customers-set-primary-contact', 'contacts-create', 'contacts-update', 'contacts-delete', 'invoice-profiles-create', 'invoice-profiles-update', 'invoice-profiles-delete', 'invoice-profiles-set-default'] as const
export type CustomerOperation = typeof customerOperations[number]
export async function enterpriseAltocCustomerWrite(event: H3Event, operation: CustomerOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  if (!customerOperations.includes(operation) || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const key = getHeader(event, 'idempotency-key')
  if (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key)) throw createError({ statusCode: 400 })
  const customerId = getRouterParam(event, 'customerId') || ''
  const childCode = getRouterParam(event, 'childCode') || ''
  if (operation === 'customers-create' ? Boolean(customerId || childCode) : !/^[1-9]\d{0,15}$/.test(customerId) || !Number.isSafeInteger(Number(customerId))) throw createError({ statusCode: 400 })
  if (childCode && !/^[A-Za-z0-9_-]{1,50}$/.test(childCode)) throw createError({ statusCode: 400 })
  const payload = await readBody<Record<string, unknown>>(event)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw createError({ statusCode: 400 })
  // Runtime owns field validation, parent/child matching and current scope checks.
  const input = { id: `${customerId}|${childCode}`, code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }
  const authorization = { ...await buildAPFPermit(event, 'altoc', 'save', input, user), operation }
  const op = `altoc.wp4a-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const result = await callEnterpriseRuntime<{ code: number, data: { data: unknown } }>(event, op, { customer: { customerId, childCode, payload }, authorization }, { idempotencyKey: key })
  if (result.code !== 0 || !result.data || !Object.hasOwn(result.data, 'data')) throw createError({ statusCode: 503 })
  return result.data
}
