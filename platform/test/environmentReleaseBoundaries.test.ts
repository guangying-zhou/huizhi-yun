import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
test('heartbeat authentication precedes environment lookup; pinned has no automatic target', () => {
  const s = source('../server/api/v1/runtime/agent-heartbeat.post.ts')
  assert.ok(s.indexOf("message: 'invalid tenant runtime control token'") < s.lastIndexOf('dataRuntimeReleaseSettings('))
  assert.match(s, /requireRuntimeReleaseUpdateMode\(instance\.release_update_mode\)/)
  assert.match(s, /requireRuntimeReleaseEnvironment\(instance\.environment\)/)
  assert.match(s, /desiredVersion: updateEnabled && releaseTarget.signingKeyCompatible \? releaseTarget.desiredVersion : ''/)
  assert.doesNotMatch(s, /requireRuntimeReleaseEnvironment\(body\./)
})
test('approval writes only selected environment tracking rows; no stable fallback', () => {
  const s = source('../server/utils/dataRuntimeReleaseRegistry.ts')
  assert.match(s, /WHERE release_signing_key_id = \? AND environment = \?\s+AND release_update_mode = 'tracking'/)
  assert.doesNotMatch(source('../server/utils/dataRuntimeRelease.ts'), /approvedVersion:\s*bootstrapApprovedVersion/)
  assert.match(source('../server/utils/tenantRuntimeEnrollment.ts'), /requireRuntimeReleaseUpdateMode\(instance\.release_update_mode\)/)
  assert.match(source('../server/utils/tenantRuntimeEnrollment.ts'), /requireRuntimeReleaseUpdateMode\(row\.release_update_mode\)/)
})
test('managed installer rejects latest before any command/download; no listeners or network', () => {
  const installer = new URL('../../data-runtime/deploy/install.sh', import.meta.url).pathname
  for (const args of [[], ['--version', 'latest'], ['--version', '1.2.3', '--update-version', 'latest']]) {
    const result = spawnSync('bash', [installer, ...args], { env: { PATH: process.env.PATH, HZY_DATA_RUNTIME_PLATFORM_URL: 'https://fixture.invalid', HZY_DATA_RUNTIME_DEPLOYMENT_ENVIRONMENT: 'prod' }, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr + result.stdout, /exact|精确|managed/i)
  }
})
