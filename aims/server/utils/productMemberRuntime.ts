import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { fetchDirectoryActiveStatuses } from '@hzy/foundation/server/utils/directoryApi'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { memberChangeInput, memberPageInput, type MemberMutation } from './productMemberInput'
import { hasProductControlCharacter, productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductMembers(event: H3Event, action: MemberMutation | 'list') {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const facts = await requireProductPermission(event, code, 'products', 'admin')
  const key = action === 'list' ? undefined : productCommandKey(getHeader(event, 'Idempotency-Key'))
  if (action !== 'list' && !key) throw createError({ statusCode: 400, message: '需要有效的 Idempotency-Key' })
  const rawId = getRouterParam(event, 'memberId') || ''
  if ((action === 'update' || action === 'revoke') && !/^[1-9]\d*$/.test(rawId)) throw createError({ statusCode: 400, message: '成员编号无效' })
  const id = action === 'update' || action === 'revoke' ? Number(rawId) : 0
  const input = action === 'list' ? memberPageInput(getQuery(event)) : memberChangeInput(action, await readBody(event), id, facts.actor_uid)
  if (!input) throw createError({ statusCode: 400, message: '成员字段、有效期或版本号无效' })
  let directory: { active_uids: string[], expires_at: number } | undefined
  if ('continuing_manager_uid' in input) {
    const needsActiveTarget = action === 'create' || (action === 'update' && input.status === 'active')
    const uids = [...new Set([input.continuing_manager_uid, ...(needsActiveTarget ? [input.uid] : [])])]
    const states = await fetchDirectoryActiveStatuses(event, uids)
    if (states.some(row => !row.active)) throw createError({ statusCode: 400, message: '目标成员或接管经理不是有效目录用户' })
    directory = { active_uids: states.map(row => row.uid), expires_at: Date.now() + 15000 }
  }
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event,
    `/v1/aims/internal/products/${encodeURIComponent(code)}/members:${action}`, {
      appCode: 'aims', method: 'POST', scope: `aims.${action === 'list' ? 'read' : 'write'} aims:products:admin`,
      query: { current_user: facts.actor_uid }, ...(key ? { idempotencyKey: key } : {}),
      body: { input, ...(directory ? { directory } : {}), authorization: { resource: 'products', action: 'admin', facts, expires_at: Date.now() + 15000 } }
    })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
