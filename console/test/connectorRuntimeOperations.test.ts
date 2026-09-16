import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Connector Runtime heartbeat is device-bound and stores only aggregate metrics', () => {
  const route = source('server/api/v1/console/service/connector-runtime/heartbeat.post.ts')
  const device = source('server/utils/connectorRuntimeDevice.ts')
  const tenantRuntime = source('../data-runtime/internal/apps/console/connector_runtime.go')
  const migration = source('../console/docs/sql/Console-SQL-Migration-v1.74-connector-runtime-operations.sql')
  const heartbeatSeed = source('../console/docs/sql/Console-SQL-Seed-v1.76-connector-runtime-heartbeat-scope.sql')
  const runtime = source('../notification-runtime/internal/runtimeapp/run.go')
  const runtimeMain = source('../notification-runtime/cmd/hzy-connector-runtime/main.go')
  const installer = source('../connector-runtime/deploy/install.sh')
  const consoleClient = source('../notification-runtime/internal/console/client.go')
  const authMiddleware = source('../foundation/server/middleware/console-auth.ts')

  assert.match(route, /requireConsoleServiceActor\([\s\S]*'console'[\s\S]*'console:connector-runtime:heartbeat'/)
  assert.match(route, /requireConsoleServiceActor[\s\S]*readBody/)
  assert.match(authMiddleware, /pathname === '\/api\/v1\/console\/service\/connector-runtime\/heartbeat'/)
  assert.match(device, /verifiedClientCode: actor\.actorId/)
  assert.doesNotMatch(device, /server\/utils\/db|queryRow|queryRows|execute|withTransaction/)
  assert.match(tenantRuntime, /verifiedClientCode != truncateConnectorRuntimeText\(connectorID, 100\)/)
  assert.match(tenantRuntime, /tenant_code=\? AND deployment_code=\?/)
  assert.match(tenantRuntime, /normalizeConnectorRuntimeMetrics/)
  assert.doesNotMatch(tenantRuntime.slice(tenantRuntime.indexOf('func normalizeConnectorRuntimeMetrics')), /title|description|mobile|email|accessToken|clientSecret/)
  assert.match(migration, /connector_runtime[\s\S]*heartbeat/)
  assert.match(heartbeatSeed, /console:connector-runtime[\s\S]*heartbeat/)
  assert.match(heartbeatSeed, /resource_code`='connector_runtime'[\s\S]*status`='active'/)
  assert.doesNotMatch(heartbeatSeed, /client_secret|enrollment_token|password/i)
  assert.match(runtime, /runConnectorHeartbeat/)
  assert.match(consoleClient, /console:connector-runtime:heartbeat/)
  assert.match(runtime, /StatusUnauthorized[\s\S]*StatusForbidden/)
  assert.match(runtime, /IsConnectorDeviceIdentityRejected/)
  assert.match(runtimeMain, /IsConnectorDeviceIdentityRejected\(err\)[\s\S]*os\.Exit\(78\)/)
  assert.match(installer, /RestartPreventExitStatus=78/)
})

test('Connector Runtime stale status is computed against database UTC and refreshed in the UI', () => {
  const enrollment = source('../data-runtime/internal/apps/console/connector_runtime.go')
  const page = source('app/pages/connector-runtime.vue')

  assert.match(enrollment, /TIMESTAMPDIFF\(SECOND,last_heartbeat_at,UTC_TIMESTAMP\(3\)\) > 180/)
  assert.match(enrollment, /"heartbeatStale":\s+heartbeatStale == 1/)
  assert.match(enrollment, /"lastHeartbeatAt":\s+nullableStringValue\(lastHeartbeat\)/)
  assert.match(page, /metadata\.value\.connector\?\.heartbeatStale === true/)
  assert.match(page, /refreshMetadataPreservingCommand[\s\S]*current\?\.installCommand[\s\S]*current\.connector\?\.lastSeenAt === result\.data\.connector\?\.lastSeenAt/)
  assert.match(page, /queueMetadataRefresh[\s\S]*setTimeout[\s\S]*refreshMetadataPreservingCommand\(\)[\s\S]*30_000/)
  assert.doesNotMatch(page, /Date\.now\(\).*lastHeartbeatAt/)
})

test('Connector Runtime revocation retires the workload identity and rotation remains one-time enrollment', () => {
  const route = source('server/api/v1/console/connector-runtime/revoke.post.ts')
  const device = source('server/utils/connectorRuntimeDevice.ts')
  const enrollment = source('../data-runtime/internal/apps/console/connector_runtime.go')
  const page = source('app/pages/connector-runtime.vue')

  assert.match(route, /requireSystemSettingsAccess\(event, 'admin'\)/)
  assert.match(route, /requireIdempotencyKey\(event/)
  assert.doesNotMatch(device, /server\/utils\/db|queryRow|queryRows|execute|withTransaction/)
  assert.match(enrollment, /connector_runtime_instances[\s\S]*status='revoked'/)
  assert.match(enrollment, /service_client_credentials[\s\S]*status='retired'/)
  assert.match(enrollment, /service_client_grants[\s\S]*status='revoked'/)
  assert.match(enrollment, /finishMutation/)
  assert.match(enrollment, /status='redeemed'/)
  assert.match(enrollment, /UPDATE service_client_credentials/)
  assert.match(enrollment, /status='retired'/)
  assert.match(page, /生成轮换指令/)
  assert.match(page, /useConfirm\(\)/)
})

test('Diagnostics use an exact typed capability and never expose operation detail', () => {
  const diagnostics = source('server/utils/connectorRuntimeDiagnostics.ts')
  const runtimeDiagnostics = source('../notification-runtime/internal/diagnostics/diagnostics.go')
  const registry = source('../notification-runtime/internal/capabilities/registry.go')

  assert.match(diagnostics, /connector-runtime:diagnostics:view/)
  assert.match(diagnostics, /\/v1\/diagnostics/)
  assert.match(registry, /runtime\.diagnostics\.read/)
  assert.match(registry, /ArbitraryHTTPProxy: false/)
  assert.match(runtimeDiagnostics, /SELECT status,COUNT\(\*\)/)
  assert.doesNotMatch(runtimeDiagnostics, /touser|title|description|result_json|error_message|provider_subject/)
})
