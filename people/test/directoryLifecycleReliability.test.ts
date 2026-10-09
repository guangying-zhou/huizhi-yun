import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { executeDirectoryLifecycleOperation } from '../server/utils/directoryLifecycleExecution.ts'
import { prepareDueDirectoryLifecycleOperations } from '../server/utils/directoryLifecyclePreparation.ts'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('People lifecycle projection is runtime-frozen and no BFF write path calls Console directly', () => {
  const middleware = source('server/middleware/tenant-runtime.ts')
  const workflow = source('server/api/v1/service/workflow/callback.post.ts')
  const retired = source('server/api/admin/directory-users/[uid]/disable.post.ts')
  assert.match(middleware, /directoryLifecycleOperationKey\(runtimeResponse\)/)
  assert.doesNotMatch(middleware + workflow, /consoleDirectoryProjection/)
  assert.match(workflow, /dispatchDirectoryLifecycleOperation/)
  assert.match(retired, /statusCode:\s*410/)
})

test('People scheduled consumers use disjoint server-side allowlisted families and bounded drain', () => {
  const directory = source('server/utils/directoryLifecycleOperation.ts')
  const assets = source('server/utils/assetsOffboardingProjectionDrain.ts')
  const scheduledRuntime = source('server/utils/scheduledRuntime.ts')
  assert.match(directory, /operationFamily: 'directory-lifecycle'/)
  assert.match(assets, /operationFamily: 'assets-offboarding'/)
  assert.match(directory, /45_000/)
  assert.match(directory, /options\.claimReserveMs \|\| 25_000/)
  assert.match(directory, /HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED/)
  assert.match(scheduledRuntime, /const workerServiceUserAgent = 'HZY-Cloudflare-Worker\/1\.0'/)
  assert.equal((scheduledRuntime.match(/'user-agent': workerServiceUserAgent/g) || []).length, 2)
})

test('People shared scheduler wake is Gateway-authenticated and tenant bound', () => {
  const wake = source('server/api/internal/integration-operations/drain.post.ts')
  const directory = source('server/utils/directoryLifecycleOperation.ts')
  assert.match(wake, /requireTenantGatewaySchedulerRequest\(event, 'people'\)/)
  assert.match(wake, /drainDirectoryLifecycleOperationsForEvent/)
  assert.match(directory, /operation\.tenantCode\) !== text\(binding\.tenant\)/)
  assert.match(directory, /operation\.deploymentCode\) !== text\(binding\.deployment\)/)
  assert.match(directory, /binding\.consoleTargetDeployment/)
  assert.match(directory, /directTarget: true/)
  assert.match(directory, /resolveConsoleRuntimeBaseUrl\(useRuntimeConfig\(event \|\| undefined\), event\)/)
  assert.doesNotMatch(directory, /'x-hzy-app-code': 'console'/)
  assert.doesNotMatch(directory, /'x-hzy-deployment': targetDeployment/)
})

test('ack loss keeps the committed People mutation pending and preserves two-hop status', () => {
  const delivery = source('server/utils/directoryLifecycleOperation.ts')
  assert.match(delivery, /catch \(error\)[\s\S]*pending: true[\s\S]*operationKey/)
  assert.match(delivery, /platformStatus\) !== 'succeeded'/)
  assert.match(delivery, /x-hzy-service-command-signature/)
})

test('People operation succeeds on the Console receipt while the Platform continuation stays independently pending', async () => {
  const operation = {
    operationId: '550e8400-e29b-41d4-a716-446655440000',
    operationKey: 'people:directory:employee-1:r7',
    tenantCode: 'tenant-1',
    deploymentCode: 'people-prod',
    sourceApp: 'people',
    targetApp: 'console',
    operationCode: 'people.directory.employment-sync.v1',
    requiredCapability: 'console:directory-employment:sync',
    idempotencyKey: 'people:directory:employee-1:r7',
    commandSchemaVersion: 'v1',
    commandSha256: 'a'.repeat(64),
    command: { employeeUid: 'employee-1', sourceRevision: 7, snapshotHash: 'b'.repeat(64) },
    fencingToken: 11
  }
  const checkpoints: Array<{ path: string, body: Record<string, unknown> }> = []
  const callRuntime = async (path: string, body: Record<string, unknown>) => {
    checkpoints.push({ path, body })
    return { status: path.endsWith(':fail') ? 'retry_wait' : 'succeeded' }
  }
  let consoleMutationCount = 0
  const callTarget = async () => {
    if (consoleMutationCount === 0) consoleMutationCount += 1
    return {
      receiptId: '660e8400-e29b-41d4-a716-446655440000',
      receiptStatus: 'succeeded',
      operationId: operation.operationId,
      operationCode: operation.operationCode,
      idempotencyKey: operation.idempotencyKey,
      commandSchemaVersion: operation.commandSchemaVersion,
      commandSha256: operation.commandSha256,
      targetBizType: 'directory_user',
      targetBizCode: 'employee-1',
      responseSummarySha256: 'c'.repeat(64),
      idempotent: false,
      result: { platformOperationKey: 'console:platform:employee-1:r7', platformStatus: 'pending' }
    }
  }

  const delivery = await executeDirectoryLifecycleOperation(operation, null, callRuntime, callTarget)
  assert.equal(delivery.synced, true)
  assert.equal(delivery.pending, false)
  assert.equal(delivery.chainPending, true)
  assert.equal(consoleMutationCount, 1)
  assert.equal(checkpoints.length, 1)
  assert.match(checkpoints[0].path, /:succeed$/)
})

test('status-less target failures are checkpointed as retryable instead of stranding the lease', async () => {
  const operation = {
    operationId: '550e8400-e29b-41d4-a716-446655440001',
    operationKey: 'people:directory:employee-2:r8',
    tenantCode: 'tenant-1',
    deploymentCode: 'people-prod',
    sourceApp: 'people',
    targetApp: 'console',
    operationCode: 'people.directory.offboarding-disable.v1',
    requiredCapability: 'console:directory-offboarding:disable',
    idempotencyKey: 'people:directory:employee-2:r8',
    commandSchemaVersion: 'v1',
    commandSha256: 'd'.repeat(64),
    command: { employeeUid: 'employee-2', sourceRevision: 8, snapshotHash: 'e'.repeat(64) },
    fencingToken: 12
  }
  const checkpoints: Array<{ path: string, body: Record<string, unknown> }> = []
  const result = await executeDirectoryLifecycleOperation(
    operation,
    null,
    async (path, body) => {
      checkpoints.push({ path, body })
      return { status: 'retry_wait' }
    },
    async () => {
      throw new TypeError('receipt payload is unavailable')
    }
  )

  assert.equal(result.synced, false)
  assert.match(checkpoints[0].path, /:fail$/)
  assert.equal(checkpoints[0].body.networkError, true)
  assert.equal(checkpoints[0].body.deliveryUncertain, false)
})

test('scheduled lifecycle preparation is bounded and preserves one asOf across cursor pages', async () => {
  const calls: Array<{ path: string, body: Record<string, unknown> }> = []
  const pages = [
    { created: 1, reused: 0, scanned: 20, nextCursor: 'cursor-20' },
    { created: 0, reused: 1, scanned: 1 }
  ]
  const result = await prepareDueDirectoryLifecycleOperations(async (path, body) => {
    calls.push({ path, body })
    return pages[calls.length - 1]
  }, { asOf: '2026-07-10T12:00:00.000Z', limit: 20, maxPages: 5 })
  assert.equal(result.pages, 2)
  assert.equal(result.created, 1)
  assert.equal(result.reused, 1)
  assert.equal(result.scanned, 21)
  assert.deepEqual(calls.map(call => call.path), [
    '/v1/people/service/directory-lifecycle:prepare-due',
    '/v1/people/service/directory-lifecycle:prepare-due'
  ])
  assert.equal(calls[0].body.asOf, calls[1].body.asOf)
  assert.equal(calls[1].body.cursor, 'cursor-20')
})

test('failed preparation page is reported without claiming success or losing prior page counts', async () => {
  let calls = 0
  const result = await prepareDueDirectoryLifecycleOperations(async () => {
    calls += 1
    if (calls === 1) return { created: 1, reused: 0, scanned: 20, nextCursor: 'cursor-20' }
    throw Object.assign(new Error('runtime unavailable'), { statusMessage: 'tenant_runtime_unavailable' })
  }, { asOf: '2026-07-10T12:00:00.000Z', limit: 20 })
  assert.equal(result.pages, 1)
  assert.equal(result.created, 1)
  assert.equal(result.scanned, 20)
  assert.equal(result.failed, true)
  assert.equal(result.errorCode, 'tenant_runtime_unavailable')
})
