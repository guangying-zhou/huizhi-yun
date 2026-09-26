import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { fetchDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import {
  buildAltocDepartmentTreeCodeIndex,
  hasAltocGlobalAdminRole,
  resolveAltocDataAccessQueryFromScopedGrants,
  scopedGrantsNeedAltocDepartmentTree,
  type AltocDepartmentScopeTreeNode
} from '../../../altoc/server/utils/altocDataAccessScope'

type AltocAccess = 'all' | 'dept' | 'self' | 'self_dept' | 'none'

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(strings)
  return String(value || '').split(/[,\s;]+/).map(item => item.trim()).filter(Boolean)
}

function currentDepartmentCodes(event: H3Event) {
  const auth = event.context.consoleAuth as { deptCode?: unknown, deptCodes?: unknown, claims?: Record<string, unknown> } | undefined
  return Array.from(new Set([
    ...strings(auth?.deptCodes), ...strings(auth?.deptCode),
    ...strings(auth?.claims?.dept_codes), ...strings(auth?.claims?.dept_code)
  ]))
}

function extractDepartmentTree(response: { data?: { tree?: AltocDepartmentScopeTreeNode[] } | AltocDepartmentScopeTreeNode[] | null, tree?: AltocDepartmentScopeTreeNode[] | null }) {
  if (Array.isArray(response.data)) return response.data
  if (Array.isArray(response.data?.tree)) return response.data.tree
  return Array.isArray(response.tree) ? response.tree : []
}

function departmentCodes(query: Record<string, unknown>) {
  return {
    access: String(query.current_user_altoc_access || '') as AltocAccess,
    departmentCodes: strings(query.current_user_altoc_dept_codes)
  }
}

async function compileAltocPermit(event: H3Event, input: { actorUid: string, tenant: string, deployment: string, contractCode: string, idempotencyKey: string }) {
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, input.actorUid, 'altoc', { resourceCode: 'contract', action: 'edit' })
  const globalAdmin = hasAltocGlobalAdminRole(scoped.roles)
  const departmentTreeCodesByRoot = !globalAdmin && scopedGrantsNeedAltocDepartmentTree(scoped.grants)
    ? buildAltocDepartmentTreeCodeIndex(extractDepartmentTree(await fetchDirectoryApi('/api/v1/directory/departments', { event })))
    : undefined
  const scope = departmentCodes(resolveAltocDataAccessQueryFromScopedGrants({
    appCode: 'altoc', grants: scoped.grants, currentDeptCodes: currentDepartmentCodes(event),
    resource: 'contract', action: 'edit', actionPolicy: scoped.actionPolicy,
    hasGlobalAdminRole: globalAdmin, departmentTreeCodesByRoot
  }))
  if (scope.access === 'none') throw createError({ statusCode: 403, message: '当前用户没有合同编辑权限' })
  return {
    actorUid: input.actorUid, tenant: input.tenant, deployment: input.deployment,
    contractCode: input.contractCode, idempotencyKey: input.idempotencyKey,
    expiresAt: enterpriseRuntimePermitExpiresAt(), resource: 'contract', action: 'edit', allowed: true,
    access: scope.access, departmentCodes: scope.departmentCodes
  }
}

async function compileAimsPermit(event: H3Event, input: { actorUid: string, tenant: string, deployment: string, contractCode: string, idempotencyKey: string }) {
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, input.actorUid, 'aims', { resourceCode: 'projects', action: 'create' })
  if (scoped.decision?.allowed !== true) throw createError({ statusCode: 403, message: '当前用户没有项目创建权限' })
  return {
    actorUid: input.actorUid, tenant: input.tenant, deployment: input.deployment,
    contractCode: input.contractCode, idempotencyKey: input.idempotencyKey,
    expiresAt: enterpriseRuntimePermitExpiresAt(), resource: 'projects', action: 'create', allowed: true
  }
}

export async function activateEnterpriseAltocContractDelivery(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const contractCode = String(getRouterParam(event, 'contractCode') || '').trim()
  const idempotencyKey = String(getHeader(event, 'Idempotency-Key') || '').trim()
  if (Object.keys(getQuery(event)).length || !contractCode || contractCode.length > 30 || !idempotencyKey || idempotencyKey.length > 191) {
    throw createError({ statusCode: 400, message: '合同编号、操作标识或请求参数无效' })
  }
  const body = await readBody(event)
  if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0)) {
    throw createError({ statusCode: 400, message: '合同激活请求不接受授权或范围参数' })
  }
  const input = { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, contractCode, idempotencyKey }
  const [authorization, aimsAuthorization] = await Promise.all([compileAltocPermit(event, input), compileAimsPermit(event, input)])
  return callEnterpriseRuntime(event, 'altoc.contracts-activate-delivery', {
    contractCode, authorization, aims_authorization: aimsAuthorization
  }, { idempotencyKey })
}
