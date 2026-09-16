import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parsePlatformLifecycleRetryIdentity } from '../server/utils/platformLifecycleRetryContract.ts'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('lifecycle retry browser contract accepts only the fixed phase and uid identity', () => {
  assert.deepEqual(parsePlatformLifecycleRetryIdentity({
    phase: 'employment_authorization_sync',
    uid: 'employee-42'
  }), {
    phase: 'employment_authorization_sync',
    uid: 'employee-42'
  })

  for (const payload of [
    { phase: 'employment_authorization_sync', uid: 'employee-42', positionCode: 'admin' },
    { phase: 'employment_authorization_sync', uid: 'employee-42', positionName: '管理员' },
    { phase: 'employment_authorization_sync', uid: 'employee-42', deptCode: 'security' },
    { phase: 'employment_authorization_sync', uid: 'employee-42', reason: 'override' },
    { phase: 'employment_authorization_sync', uid: 'employee-42', idempotencyKey: 'browser-controlled' },
    { phase: 'employment_authorization_sync', uid: 'employee-42', operationId: '550e8400-e29b-41d4-a716-446655440000' }
  ]) {
    assert.throws(() => parsePlatformLifecycleRetryIdentity(payload), { statusCode: 400 })
  }
})

test('retry source and cancellation SQL are tenant and deployment bound', () => {
  const drain = source('server/utils/platformLifecycleActionableDrain.ts')
  const runtime = source('../data-runtime/internal/apps/console/platform_lifecycle.go')
  const retry = source('server/api/v1/console/authorization-lifecycle/retry.post.ts')

  assert.match(runtime, /WHERE tenant_code=\? AND deployment_code=\? AND source_app='console'/)
  assert.match(runtime, /LIMIT 2/)
  assert.match(runtime, /if len\(found\) != 1/)
  assert.match(runtime, /"command":\s+command/)
  assert.match(runtime, /"commandSha256":\s+found\[0\]\.commandSHA256/)
  assert.match(runtime, /AND operation_id=\? AND operation_code=\? AND source_biz_code=\?/)
  assert.match(drain, /getConsolePlatformLifecycleRetrySource\(input\.event/)
  assert.match(drain, /cancelConsolePlatformLifecycleRetry\(input\.event/)
  assert.match(retry, /executePlatformLifecycleRetryCommand\(retrySource\)/)
  assert.match(retry, /cancelDeadLetterPlatformLifecycleForRetry\(\{ event, uid, phase, operationId: retrySource\.operationId \}\)/)
  assert.match(retry, /`\$\{input\.idempotencyKey\}:audit:\$\{input\.result\}`/)
  assert.doesNotMatch(retry, /reclaimPlatformUserAuthorizationForOffboarding|syncPlatformUserEmploymentAuthorization/)
  assert.match(source('server/utils/platformLifecycleOperation.ts'), /const sourceDeployment = text\(command\.sourceDeploymentCode\)/)
  assert.doesNotMatch(drain, /server\/utils\/db|queryRow|execute|withTransaction/)
})
