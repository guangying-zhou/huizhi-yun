import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { isPeopleManagedConnectorJob } from '../server/utils/connectorPeopleJobBoundary.ts'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('DingTalk People sync is an explicit People-owned asynchronous Connector Runtime job', () => {
  const startRoute = source('server/api/v1/console/connector-runtime/people-sync-jobs/index.post.ts')
  const statusRoute = source('server/api/v1/console/connector-runtime/people-sync-jobs/[jobId].get.ts')
  const cancelRoute = source('server/api/v1/console/connector-runtime/people-sync-jobs/[jobId]/cancel.post.ts')
  const retryRoute = source('server/api/v1/console/connector-runtime/people-sync-jobs/[jobId]/retry.post.ts')
  const serviceStart = source('server/api/v1/console/service/connector-runtime/people-sync-jobs/index.post.ts')
  const serviceStatus = source('server/api/v1/console/service/connector-runtime/people-sync-jobs/[jobId].get.ts')
  const serviceCancel = source('server/api/v1/console/service/connector-runtime/people-sync-jobs/[jobId]/cancel.post.ts')
  const serviceRetry = source('server/api/v1/console/service/connector-runtime/people-sync-jobs/[jobId]/retry.post.ts')
  const client = source('server/utils/connectorPeopleSync.ts')
  const page = source('app/pages/connector-runtime.vue')
  const serviceIdentity = source('../data-runtime/internal/apps/console/auth_service_tokens.go')

  for (const legacyRoute of [startRoute, statusRoute, cancelRoute, retryRoute]) {
    assert.match(legacyRoute, /statusCode: 410/)
    assert.match(legacyRoute, /People/)
  }
  assert.match(serviceStart, /console:hr-source-sync:execute[\s\S]*verifyPeopleHRSourceServiceCommand[\s\S]*setResponseStatus\(event, 202\)/)
  assert.match(serviceStatus, /console:hr-source-sync:view/)
  assert.match(serviceCancel, /console:hr-source-sync:execute[\s\S]*verifyPeopleHRSourceServiceCommand/)
  assert.match(serviceRetry, /console:hr-source-sync:execute[\s\S]*verifyPeopleHRSourceServiceCommand[\s\S]*setResponseStatus\(event, 202\)/)
  assert.match(client, /provider: 'dingtalk'/)
  assert.match(client, /integrationCode: 'dingtalk\.default'/)
  assert.match(client, /connector-runtime:people:sync/)
  assert.match(client, /connector-runtime:jobs:view/)
  assert.match(client, /connector-runtime:jobs:cancel/)
  assert.match(client, /originalActorUid/)
  assert.match(client, /'Idempotency-Key': idempotencyKey/)
  assert.match(serviceIdentity, /"connector-runtime:people:sync"/)
  assert.match(serviceIdentity, /"connector-runtime:jobs:view"/)
  assert.match(serviceIdentity, /"connector-runtime:jobs:cancel"/)
  assert.doesNotMatch(page, /startPeopleSync|cancelPeopleSync|retryPeopleSync/)
  assert.match(page, /业务同步入口由 People 管理/)
  assert.match(page, /\/shell\/people\?target=%2Fpeople%2Fsettings%2Fhr-source-sync/)
  assert.doesNotMatch(client, /api\.dingtalk\.com|oapi\.dingtalk\.com|appSecret|accessToken/)
  assert.doesNotMatch(page, /setInterval|cron|schedule/)
})

test('People sync crosses the configured signed data-runtime boundary without a database credential', () => {
  const installer = source('../connector-runtime/deploy/install.sh')
  const loopback = source('../notification-runtime/internal/peoplejobs/loopback.go')
  const runtimeServer = source('../data-runtime/internal/server/server.go')
  const peopleAdapter = source('../data-runtime/internal/apps/people/connector_sync.go')
  const seed = source('../console/docs/sql/Console-SQL-Seed-v1.73-connector-runtime-people-sync.sql')
  const jobControlSeed = source('../console/docs/sql/Console-SQL-Seed-v1.75-connector-runtime-job-control.sql')

  assert.match(installer, /HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL is required/)
  assert.match(installer, /must be an HTTPS origin or a loopback HTTP origin/)
  assert.match(installer, /HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL="\$HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL"/)
  assert.doesNotMatch(installer, /DB_PASSWORD|DB_HOST|DB_NAME/)
  assert.match(loopback, /runtime\/internal\/connector-runtime\/people-sync-batches/)
  assert.match(loopback, /rsa\.SignPSS/)
  assert.match(loopback, /parsed\.Scheme == "https"/)
  assert.match(loopback, /http\.ErrUseLastResponse/)
  assert.match(runtimeServer, /AuthenticateConnectorRuntimeRequest/)
  assert.match(runtimeServer, /ResolveDingTalkPeopleBatch/)
  assert.match(peopleAdapter, /people_connector_sync_receipts/)
  assert.match(peopleAdapter, /connector_people_batch_conflict/)
  assert.match(seed, /'connector-runtime:people','sync'/)
  assert.match(seed, /'connector-runtime:jobs','view'/)
  assert.match(jobControlSeed, /'connector-runtime:jobs','cancel'/)
})

test('People job failures are sanitized and retries preserve a typed endpoint boundary', () => {
  const client = source('server/utils/connectorPeopleSync.ts')

  assert.match(client, /\/people-sync-jobs\/\$\{encodeURIComponent\(normalizedJobId\)\}\/cancel/)
  assert.match(client, /\/people-sync-jobs\/\$\{encodeURIComponent\(normalizedJobId\)\}\/retry/)
  assert.match(client, /typeof failure\.data\?\.message === 'string'/)
  assert.doesNotMatch(client, /error instanceof Error \? error\.message/)
  assert.doesNotMatch(client, /targetUrl|headers:\s*input|method:\s*input/)
})

test('People job controls fail closed for directory profile and unrelated job IDs', () => {
  const client = source('server/utils/connectorPeopleSync.ts')

  assert.equal(isPeopleManagedConnectorJob({ objectScopes: ['people'] }), true)
  assert.equal(isPeopleManagedConnectorJob({ objectScopes: ['organization', 'people'] }), true)
  assert.equal(isPeopleManagedConnectorJob({ objectScopes: ['people', 'directory_profiles'] }), false)
  assert.equal(isPeopleManagedConnectorJob({ objectScopes: ['directory_profiles'] }), false)
  assert.equal(isPeopleManagedConnectorJob({ objectScopes: ['organization'] }), false)
  assert.equal(isPeopleManagedConnectorJob({ objectScopes: ['people', 'unknown'] }), false)
  assert.equal(isPeopleManagedConnectorJob({}), false)

  assert.match(client, /getConnectorPeopleSync[\s\S]*isPeopleManagedConnectorJob\(job\)/)
  assert.match(client, /cancelConnectorPeopleSync[\s\S]*await getConnectorPeopleSync\(event, normalizedJobId\)[\s\S]*\/cancel/)
  assert.match(client, /retryConnectorPeopleSync[\s\S]*await getConnectorPeopleSync\(event, normalizedJobId\)[\s\S]*\/retry/)
})
