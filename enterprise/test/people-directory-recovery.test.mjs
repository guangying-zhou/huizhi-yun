import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'

const id = '57bba46a-1c80-4c51-8a60-62d81953cff0'
test('recovery browser input is closed and never accepts target facts or replacement commands', async () => {
  const hooks = registerHooks({ resolve(s, c, next) {
    let source
    if (s === 'h3') source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getHeader=()=>'';export const getQuery=()=>({});export const getRouterParam=()=>'';export const readBody=async()=>({});export const setHeader=()=>{}`
    if (s.endsWith('/directoryServiceCommand')) source = `export const callDirectoryLifecycleProbe=async()=>({})`
    if (s === './enterprisePeopleFacts') source = `export const executePeopleFacts=async()=>({})`
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(s, c)
  } })
  try {
    const { normalizeDirectoryRecovery } = await import('../server/utils/enterprisePeopleDirectoryRecovery.ts')
    assert.equal(normalizeDirectoryRecovery('replay', id, { expectedVersion: 7, reason: '核对后恢复原命令' }).payload.expectedVersion, 7)
    assert.equal(normalizeDirectoryRecovery('list', '', { page: 2, pageSize: 20 }).page, 2)
    for (const field of ['uid', 'sourceApp', 'status', 'confirmation', 'command', 'operationKey', 'forceSuccess']) assert.throws(() => normalizeDirectoryRecovery('replay', id, { expectedVersion: 7, reason: '核对后恢复原命令', [field]: true }), { statusCode: 400 })
    for (const bad of ['../id', '57bba46a-1c80-1c51-8a60-62d81953cff0']) assert.throws(() => normalizeDirectoryRecovery('probe', bad, {}), { statusCode: 400 })
    assert.throws(() => normalizeDirectoryRecovery('probe', id, { uid: 'other' }), { statusCode: 400 })
    assert.throws(() => normalizeDirectoryRecovery('replay', id, { expectedVersion: 0, reason: '核对后恢复原命令' }), { statusCode: 400 })
  } finally { hooks.deregister() }
})
test('directory recovery has independent global view/replay gates and a fixed two-family Runtime boundary', () => {
  const host = readFileSync(new URL('../server/utils/enterprisePeopleFacts.ts', import.meta.url), 'utf8')
  const core = readFileSync(new URL('../../data-runtime/internal/enterpriseapf/people_directory_recovery.go', import.meta.url), 'utf8')
  const ui = readFileSync(new URL('../app/components/PeopleDirectoryRecoveryPage.vue', import.meta.url), 'utf8')
  assert.ok(host.includes('hasTenantGlobalIntegrationOperationGrant'))
  for (const x of ['source_app=\'enterprise\'', 'service_client_id=\'enterprise.runtime\'', 'target_app=\'console\'', 'source_biz_type=\'employee\'', 'people.directory.employment-sync.v1', 'people.directory.offboarding-disable.v1', 'ReplayInTransaction', 's.receipt', 'scope.Access != "all"']) assert.ok(core.includes(x), x)
  assert.doesNotMatch(core, /UPDATE.*command_json|forceSuccess|source_app='people'/)
  for (const x of ['hasPermission(\'integration_operations\', \'view\')', 'hasPermission(\'integration_operations\', \'replay\')', 'Console 目录／会话', 'Platform', '共 {{ total }} 条', ':loading="pending"', 'useConfirm()', 'Idempotency-Key', 'expectedVersion']) assert.ok(ui.includes(x), x)
})
