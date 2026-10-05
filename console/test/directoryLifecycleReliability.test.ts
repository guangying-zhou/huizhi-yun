import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { H3Event } from 'h3'
import {
  resolvePeopleDirectoryTargetBinding,
  verifyPeopleDirectorySignature
} from '../server/utils/directoryLifecycleReliable.ts'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(row).sort().map(key => [key, canonical(row[key])]))
  }
  return value
}

test('Tenant Runtime atomically owns Directory receipt, watermark and Platform operation', () => {
  const reliable = source('server/utils/directoryLifecycleReliable.ts')
  const runtime = readFileSync(
    new URL('../../data-runtime/internal/apps/directory/console_lifecycle.go', import.meta.url),
    'utf8'
  )
  assert.doesNotMatch(reliable, /service_command_receipt|directory_lifecycle_scope_versions|integration_operation|server\/utils\/db/)
  assert.match(runtime, /NewReceiptRepository/)
  assert.match(runtime, /directory_lifecycle_scope_versions/)
  assert.match(runtime, /INSERT INTO integration_operation/)
  assert.match(reliable, /sourceRevision/)
  assert.match(runtime, /staleSkipped/)
  assert.match(runtime, /lifecycle_source_version_hash_mismatch/)
  assert.match(runtime, /platformStatus/)
  assert.match(runtime, /upsertConsoleUserSubject/)
  assert.match(runtime, /operation_logs/)
})

test('Console Platform drain is default-off, bounded, lease-recovering and fenced', () => {
  const drain = source('server/utils/platformLifecycleOperation.ts')
  const runtime = source('../data-runtime/internal/apps/console/platform_lifecycle.go')
  assert.match(drain, /HZY_CONSOLE_PLATFORM_LIFECYCLE_SYNC_ENABLED/)
  assert.match(drain, /\/v1\/console\/platform-lifecycle\/drain\/claim/)
  assert.match(drain, /\/v1\/console\/platform-lifecycle\/drain\/checkpoint/)
  assert.match(runtime, /locked_until<UTC_TIMESTAMP/)
  assert.match(runtime, /integration_operation_attempt/)
  assert.match(runtime, /fencing_token=\?/)
  assert.match(runtime, /RowsAffected/)
  assert.match(drain, /45_000/)
  assert.match(drain, /25_000/)
  assert.doesNotMatch(drain, /server\/utils\/db|queryRow\(|queryRows\(|withTransaction\(/)
})

test('Tenant Gateway scheduler invokes the Platform lifecycle drains with tenant context', () => {
  const bridge = source('server/api/internal/integration-operations/drain.post.ts')
  const renderer = source('scripts/render-cloudflare-config.mjs')
  assert.match(bridge, /requireTenantGatewaySchedulerRequest\(event, 'console'\)/)
  assert.match(bridge, /drainPlatformLifecycleOperationsForEvent\(event/)
  assert.match(bridge, /drainPlatformLifecycleActionablesForEvent\(event/)
  assert.doesNotMatch(renderer, /triggers: \{ crons:/)
})

test('Console BFF verifies the legacy canonical signature before Runtime verifies the command digest', () => {
  const reliable = source('server/utils/directoryLifecycleReliable.ts')
  const runtimeClient = readFileSync(
    new URL('../../foundation/server/utils/consoleTenantRuntimeClient.ts', import.meta.url),
    'utf8'
  )
  const runtime = readFileSync(
    new URL('../../data-runtime/internal/apps/directory/console_lifecycle.go', import.meta.url),
    'utf8'
  )
  assert.match(reliable, /console:directory-employment:sync/)
  assert.match(reliable, /console:directory-offboarding:disable/)
  assert.match(reliable, /timingSafeEqual/)
  assert.match(reliable, /originalActorUid/)
  assert.match(runtimeClient, /getConsoleOidcPublishedJwks[\s\S]*serviceTokenSourceBinding: 'service-client-policy'/)
  assert.match(runtimeClient, /verifyConsoleOidcServiceTokenState[\s\S]*serviceTokenSourceBinding: 'service-client-policy'/)
  assert.match(runtimeClient, /applyConsoleDirectoryLifecycle[\s\S]*serviceTokenSourceBinding: 'service-client-policy'/)
  assert.match(runtime, /ReceiptCommandFromBody/)
  assert.match(runtime, /source_provider='people'/)
})

test('People lifecycle target binding is canonical for the authenticated tenant', () => {
  const event = (targetDeployment: string) => ({
    node: { req: { headers: { 'x-hzy-service-command-target-deployment': targetDeployment } } }
  }) as H3Event

  assert.deepEqual(resolvePeopleDirectoryTargetBinding(event('tenant-1-console'), 'tenant-1'), {
    tenantId: 'tenant-1',
    deploymentId: 'tenant-1-console'
  })
  assert.throws(
    () => resolvePeopleDirectoryTargetBinding(event('tenant-2-console'), 'tenant-1'),
    (error: unknown) => Number((error as { statusCode?: unknown }).statusCode) === 403
  )
})

test('Console signature binds trusted source actor context and target deployment before transaction work', () => {
  const path = '/api/v1/console/service/directory/users/employee-1/employment'
  const token = 'service-token-secret'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const command = { employeeUid: 'employee-1', originalActorUid: 'hr-1', snapshotHash: 'b'.repeat(64), sourceRevision: 7 }
  const commandSha256 = createHash('sha256').update(JSON.stringify(canonical(command))).digest('hex')
  const serviceCommand = {
    sourceApp: 'people',
    sourceDeployment: 'people-prod',
    targetDeployment: 'console-prod',
    targetApp: 'console',
    operationId: '550e8400-e29b-41d4-a716-446655440000',
    operationCode: 'people.directory.employment-sync.v1',
    requiredCapability: 'console:directory-employment:sync',
    idempotencyKey: 'people:directory:employee-1:r7',
    commandSchemaVersion: 'v1',
    commandSha256,
    command
  }
  const message = `POST\n${path}\ntenant-1\npeople-prod\nconsole-prod\npeople\nconsole\n${serviceCommand.operationId}\n${serviceCommand.operationCode}\n${serviceCommand.requiredCapability}\n${serviceCommand.idempotencyKey}\n${serviceCommand.commandSchemaVersion}\n${serviceCommand.commandSha256}\n${command.originalActorUid}\n${timestamp}`
  const signature = createHmac('sha256', token).update(message).digest('hex')
  const headers = {
    'authorization': `Bearer ${token}`,
    'x-hzy-tenant': 'tenant-1',
    'x-hzy-service-command-source-deployment': 'people-prod',
    'x-hzy-service-command-target-deployment': 'console-prod',
    'x-hzy-service-command-timestamp': timestamp,
    'x-hzy-service-command-signature': signature
  }
  const event = (currentPath: string, currentHeaders: Record<string, string>) => ({ path: currentPath, node: { req: { headers: currentHeaders } } }) as H3Event
  const binding = { tenantId: 'tenant-1', deploymentId: 'console-prod' }
  assert.doesNotThrow(() => verifyPeopleDirectorySignature(event(path, headers), { serviceCommand }, binding))

  const cases: Array<{ name: string, path?: string, headers?: Record<string, string>, command?: typeof serviceCommand }> = [
    { name: 'header source deployment', headers: { ...headers, 'x-hzy-service-command-source-deployment': 'people-other' } },
    { name: 'envelope source deployment', command: { ...serviceCommand, sourceDeployment: 'people-other' } },
    { name: 'header target deployment', headers: { ...headers, 'x-hzy-service-command-target-deployment': 'console-other' } },
    { name: 'envelope target deployment', command: { ...serviceCommand, targetDeployment: 'console-other' } },
    { name: 'tenant', headers: { ...headers, 'x-hzy-tenant': 'tenant-other' } },
    { name: 'path', path: `${path}-other` },
    { name: 'capability', command: { ...serviceCommand, requiredCapability: 'console:directory-offboarding:disable' } },
    { name: 'hash', command: { ...serviceCommand, commandSha256: 'd'.repeat(64) } },
    { name: 'actor', command: { ...serviceCommand, command: { ...command, originalActorUid: 'hr-other' } } },
    { name: 'timestamp', headers: { ...headers, 'x-hzy-service-command-timestamp': String(Number(timestamp) - 61) } },
    { name: 'bearer token actor', headers: { ...headers, authorization: 'Bearer other-service-token' } }
  ]
  let transactionExecuteCount = 0
  for (const item of cases) {
    assert.throws(() => {
      verifyPeopleDirectorySignature(event(item.path || path, item.headers || headers), { serviceCommand: item.command || serviceCommand }, binding)
      transactionExecuteCount += 1
    }, (error: unknown) => Number((error as { statusCode?: unknown }).statusCode) === 403, item.name)
  }
  assert.equal(transactionExecuteCount, 0)
})
