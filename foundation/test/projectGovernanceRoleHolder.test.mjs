import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// 项目治理唯一角色持有人：独立 Aims BFF 与 Enterprise Host 共用的 Foundation 实现。

test('project governance role holder resolves a fresh singleton holder and keeps dependency failures as 503', async () => {
  const state = { baseUrl: 'https://console.test', response: null, fetches: [], tokens: [] }
  globalThis.__roleHolder = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === './serviceAppUrl') source = 'export const resolveServiceAppBaseUrl=()=>globalThis.__roleHolder.baseUrl'
    if (specifier === './serviceOidc') source = 'export const requestServiceAccessToken=async(o)=>{globalThis.__roleHolder.tokens.push(o);return "svc"};export const trustedServiceRequestHeaders=()=>({"x-hzy-app-code":"console"});export const fetchConsoleServiceJson=async(_e,url,init)=>{globalThis.__roleHolder.fetches.push({url:String(url),init});const r=globalThis.__roleHolder.response;if(typeof r==="function")return r();return r}'
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    return next(specifier, context)
  } })
  const event = {}
  const resolved = (uids, revision = 7) => ({ code: 0, data: { roles: [{ roleCode: 'project_director', revision, status: uids.length === 1 ? 'resolved' : 'ambiguous', errorCode: uids.length ? (uids.length > 1 ? 'role_holder_ambiguous' : null) : 'role_holder_missing', holders: uids.map(uid => ({ uid, displayName: `N-${uid}` })) }] } })
  const rejectsWith = async (promise, statusCode, message) => {
    await assert.rejects(promise, error => error.statusCode === statusCode && (message === undefined || error.message === message))
  }
  try {
    const { resolveProjectGovernanceRoleHolder, requireCurrentProjectGovernanceRoleHolder } = await import('../server/utils/projectGovernanceRoleHolder.ts')

    state.response = resolved(['U1'])
    assert.deepEqual(await resolveProjectGovernanceRoleHolder(event, 'project_director'), { roleCode: 'project_director', revision: 7, uid: 'U1', displayName: 'N-U1' })
    assert.deepEqual(state.tokens[0], { audience: 'console', scope: 'console:authorization-role-holders:read', event })
    assert.equal(state.fetches[0].url, 'https://console.test/api/v1/console/service/authorization/role-holders?roleCodes=project_director')
    assert.equal(state.fetches[0].init.headers.authorization, 'Bearer svc')
    assert.equal(state.fetches[0].init.timeout, 5000)

    // 每次都重新读取，不缓存持有人。
    assert.equal((await requireCurrentProjectGovernanceRoleHolder(event, 'project_director', 'U1')).revision, 7)
    assert.equal(state.fetches.length, 2)

    await rejectsWith(requireCurrentProjectGovernanceRoleHolder(event, 'project_director', 'U2'), 403, 'current_project_director_required')
    await rejectsWith(requireCurrentProjectGovernanceRoleHolder(event, 'project_director', ' '), 401)

    state.response = resolved([])
    await rejectsWith(resolveProjectGovernanceRoleHolder(event, 'project_director'), 409, 'role_holder_missing')
    state.response = resolved(['U1', 'U2'])
    await rejectsWith(resolveProjectGovernanceRoleHolder(event, 'project_director'), 409, 'role_holder_ambiguous')
    state.response = resolved(['U1'], 0)
    await rejectsWith(resolveProjectGovernanceRoleHolder(event, 'project_director'), 503, 'authorization_role_holder_revision_unavailable')
    state.response = { code: 50301, message: 'authorization_role_holders_policy_unavailable' }
    await rejectsWith(resolveProjectGovernanceRoleHolder(event, 'project_director'), 503)

    // Console 明确拒绝服务身份 → 403；网络/5xx → 503，不伪装成用户缺权。
    state.response = () => {
      throw Object.assign(new Error('forbidden'), { statusCode: 403 })
    }
    await rejectsWith(resolveProjectGovernanceRoleHolder(event, 'project_director'), 403)
    state.response = () => {
      throw Object.assign(new Error('bad gateway'), { statusCode: 502 })
    }
    await rejectsWith(resolveProjectGovernanceRoleHolder(event, 'project_director'), 503, 'authorization_role_holders_policy_unavailable')
    state.response = () => {
      throw new Error('ECONNREFUSED')
    }
    await rejectsWith(requireCurrentProjectGovernanceRoleHolder(event, 'project_director', 'U1'), 503, 'authorization_role_holders_policy_unavailable')

    state.baseUrl = ''
    await rejectsWith(resolveProjectGovernanceRoleHolder(event, 'qa'), 503, 'authorization_role_holders_policy_unavailable')
  } finally {
    hooks.deregister()
    delete globalThis.__roleHolder
  }
})
