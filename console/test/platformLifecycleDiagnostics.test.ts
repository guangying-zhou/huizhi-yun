import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)
  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

test('lifecycle diagnostic input is canonical and bounded before a query can be built', () => {
  const diagnostics = source('server/utils/platformLifecycleDiagnostics.ts')
  assert.match(diagnostics, /operationIdPattern/)
  assert.match(diagnostics, /Math\.min\(Math\.max\(Math\.floor\(parsed\), 1\), 100\)/)
  assert.match(diagnostics, /if \(!operationIdPattern\.test\(operationId\)\) return null/)
})

test('lifecycle diagnostic routes enforce both read grants before tenant-bound queries', () => {
  const list = source('server/api/v1/console/authorization-lifecycle/operations/index.get.ts')
  const attempts = source('server/api/v1/console/authorization-lifecycle/operations/[operationId]/attempts.get.ts')

  assertBefore(list, 'requirePermission(event, \'authorization_lifecycle\', \'view\'', 'listPlatformLifecycleOperations({')
  assertBefore(list, 'requirePermission(event, \'audit_logs\', \'view\'', 'listPlatformLifecycleOperations({')
  assertBefore(attempts, 'requirePermission(event, \'authorization_lifecycle\', \'view\'', 'listPlatformLifecycleAttempts({')
  assertBefore(attempts, 'requirePermission(event, \'audit_logs\', \'view\'', 'listPlatformLifecycleAttempts({')
  assert.match(list, /listPlatformLifecycleOperations/)
  assert.match(attempts, /parsePlatformLifecycleDiagnosticOperationId/)
  assert.match(attempts, /listPlatformLifecycleAttempts/)
})

test('lifecycle diagnostic SQL is binding-scoped, operation-code-scoped and browser allow-listed', () => {
  const diagnostics = source('server/utils/platformLifecycleDiagnostics.ts')
  const runtime = source('../data-runtime/internal/apps/console/platform_lifecycle.go')

  assert.match(diagnostics, /getConsolePlatformLifecycleOperations/)
  assert.match(diagnostics, /getConsolePlatformLifecycleAttempts/)
  assert.match(runtime, /tenant_code=\?/)
  assert.match(runtime, /deployment_code=\?/)
  assert.match(runtime, /source_app='console'/)
  assert.match(runtime, /target_app='platform'/)
  assert.match(runtime, /platformEmploymentSyncCode/)
  assert.match(runtime, /platformOffboardingCode/)
  assert.match(runtime, /attempt\.attempt_no/)

  const diagnosticsRuntime = runtime.slice(
    runtime.indexOf('func (a *Adapter) PlatformLifecycleOperations'),
    runtime.indexOf('func (a *Adapter) PlatformLifecycleRetrySource')
  )
  const selectStatements = diagnosticsRuntime.match(/SELECT[\s\S]*?FROM integration_operation/g) || []
  const selected = selectStatements.join('\n')
  for (const forbidden of [
    'command_json', 'command_sha256', 'idempotency_key', 'operation_key',
    'target_receipt_id', 'response_summary_sha256', 'last_error_summary',
    'locked_until', 'fencing_token'
  ]) {
    assert.doesNotMatch(selected, new RegExp(forbidden))
  }
  assert.doesNotMatch(diagnostics, /server\/utils\/db|queryRow|execute|withTransaction/)
})

test('admin lifecycle screen consumes only the safe timeline endpoints', () => {
  const page = source('app/pages/admin/logs.vue')
  assert.match(page, /Console → Platform 投递时间线/)
  assert.match(page, /\/api\/v1\/console\/authorization-lifecycle\/operations/)
  assert.match(page, /viewLifecycleOperationTimeline/)
  assert.match(page, /lifecycleAttemptColumns/)
  assert.match(page, /稳定错误码/)
  assert.doesNotMatch(page, /commandJson|commandSha256|idempotencyKey|fencingToken|lastErrorSummary/)
})
