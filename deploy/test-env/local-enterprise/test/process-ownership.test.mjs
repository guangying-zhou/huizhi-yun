import assert from 'node:assert/strict'
import test from 'node:test'
import { ownedProcesses } from '../process-ownership.mjs'
const config = { root: '/workspace', profilePath: '/config/profile.json', mode: 'dev' }
const row = () => ({ name: 'hzy0-enterprise', pid: 123, pm2_env: { pm_cwd: '/workspace', pm_exec_path: '/workspace/deploy/test-env/local-enterprise/run-process.mjs', args: ['--app','enterprise','--profile','/config/profile.json','--mode','dev'], status: 'online', secret: 'must-not-print' } })
test('inventory only exposes owned process summary, not environment', () => {
  const result = ownedProcesses([row(), {name:'unrelated'}], config)
  assert.equal(result.length,1)
  assert.equal(JSON.stringify(result).includes('must-not-print'),false)
})
test('same-name process with different cwd, runner, profile or mode is not adopted', () => {
  for (const change of [r=>r.pm2_env.pm_cwd='/other',r=>r.pm2_env.pm_exec_path='/other',r=>r.pm2_env.args[3]='/other.json',r=>r.pm2_env.args[5]='node']) {
    const r=row();change(r);assert.throws(()=>ownedProcesses([r],config),/Refusing/)
  }
  assert.throws(()=>ownedProcesses([row(),row()],config),/Duplicate/)
})

test('owned Collab process is summarized without exposing its environment', () => {
  const collab = row()
  collab.name = 'hzy0-collab'
  collab.pm2_env.args[1] = 'collab'
  collab.pm2_env.COLLAB_SERVICE_CLIENT_SECRET = 'fixture'
  const result = ownedProcesses([collab], config)
  assert.deepEqual(result, [{ name: 'hzy0-collab', pid: 123, status: 'online', restarts: undefined }])
  assert.doesNotMatch(JSON.stringify(result), /fixture/)
})
