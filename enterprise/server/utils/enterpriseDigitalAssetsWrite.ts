import { createError, getHeader, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from '../../../assets/server/utils/assetsScopedAuthorizationCore'

const operations = { create: 'assets.digital-assets-create', edit: 'assets.digital-assets-edit' } as const
const fields = new Set(['digital_code', 'digital_name', 'digital_type', 'storage_location', 'owner_uid', 'access_scope', 'project_code', 'environment_id', 'status', 'notes'])

export async function handleEnterpriseDigitalAssetsWrite(event: H3Event, action: keyof typeof operations) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const id = action === 'edit' ? String(getRouterParam(event, 'id') || '').trim() : ''
  if (!Object.hasOwn(operations, action) || (action === 'edit' && !/^[1-9][0-9]{0,18}$/.test(id))) throw createError({ statusCode: 400, message: '数字资产标识无效' })
  const idempotencyKey = getHeader(event, 'Idempotency-Key')?.trim()
  if (!idempotencyKey || idempotencyKey.length > 240) throw createError({ statusCode: 400, message: '缺少有效操作标识' })
  const input = await readBody<Record<string, unknown>>(event)
  if (!input || Array.isArray(input) || Object.keys(input).some(key => !fields.has(key))) throw createError({ statusCode: 400, message: '数字资产内容无效' })
  await prepareEnterpriseRuntime(event, operations[action])
  const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode: 'digital_assets', action: 'edit' })
  const scope = assetsObjectScopeFromScopedAuthorization(snapshot, 'digital_assets', 'edit')
  if (scope.access === 'none') throw createError({ statusCode: 403, message: '无数字资产编辑权限', data: { code: 'person_permission_denied' } })
  return callEnterpriseRuntime(event, operations[action], {
    ...(id ? { id } : {}), input,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'digital_assets', action: 'edit', expiresAt: enterpriseRuntimePermitExpiresAt(), scope: assetsObjectScopeQuery(scope) }
  }, { idempotencyKey })
}
