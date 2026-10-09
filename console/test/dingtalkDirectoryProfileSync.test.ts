import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  DingTalkDirectoryProfileContractError,
  normalizeDirectoryEmail,
  parseDingTalkDirectoryProfileBatch
} from '../server/utils/dingtalkDirectoryProfileContract.ts'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('DingTalk directory profile contract normalizes email and fixes the provider boundary', () => {
  const batch = parseDingTalkDirectoryProfileBatch({
    jobId: 'crj_12345678901234567890',
    batchNumber: 1,
    final: false,
    provider: 'dingtalk',
    integrationCode: 'dingtalk.default',
    watermark: '2026-07-15T00:00:00Z',
    users: [{ providerSubject: 'ding-user', email: ' USER@Example.COM ', name: ' 张 三 ' }]
  })
  assert.equal(batch.users[0]?.email, 'user@example.com')
  assert.equal(batch.users[0]?.name, '张 三')
  assert.equal(normalizeDirectoryEmail('not-an-email'), '')
  assert.throws(
    () => parseDingTalkDirectoryProfileBatch({ ...batch, integrationCode: 'dingtalk.identity' }),
    (error: unknown) => error instanceof DingTalkDirectoryProfileContractError && error.statusCode === 409
  )
})

test('DingTalk directory profile callback is service-only, idempotent, and name-only', () => {
  const route = source('server/api/v1/console/service/directory/dingtalk-profile-sync-batches.post.ts')
  const apply = source('../data-runtime/internal/apps/directory/console_dingtalk_profile.go')
  const legacyStart = source('server/api/v1/console/directory/sync-jobs/index.post.ts')
  const peopleClient = source('../people/server/utils/dingTalkHRSource.ts')
  const connector = source('server/utils/connectorDirectorySync.ts')
  const enrollment = source('../data-runtime/internal/apps/console/connector_runtime.go')
  const seed = source('../console/docs/sql/Console-SQL-Seed-v1.78-connector-runtime-directory-profile-sync.sql')
  const runtimeClient = source('../notification-runtime/internal/console/client.go')
  const runtimeRegistry = source('../notification-runtime/internal/capabilities/registry.go')
  const consoleTenantRuntimeClient = source('../foundation/server/utils/consoleTenantRuntimeClient.ts')
  const tenantRuntimeClient = source('../foundation/server/utils/tenantRuntimeClient.ts')

  assert.match(route, /requireConsoleServiceActor\([\s\S]*'console'[\s\S]*'console:directory-profiles:sync'/)
  assert.match(route, /requireConsoleServiceActor[\s\S]*readBody/)
  assert.match(source('server/utils/vault.ts'), /event\.context\.consoleAuth\s*=\s*consoleServiceActorContext/)
  assert.match(route, /applyConsoleDingTalkDirectoryProfileCommand\(event, 'batch'/)
  assert.doesNotMatch(route, /server\/utils\/db|waitUntil|projectSubjects/)
  assert.match(apply, /IdempotencyKey/)
  assert.match(apply, /LOWER\(TRIM\(email\)\) IN/)
  assert.match(apply, /SET display_name=\?,real_name=\?,updated_at=UTC_TIMESTAMP\(\) WHERE uid=\?/)
  const directoryUserUpdate = apply.match(/UPDATE directory_users[\s\S]*?WHERE uid=\?/)?.[0] || ''
  assert.ok(directoryUserUpdate)
  assert.doesNotMatch(directoryUserUpdate, /(?:username|email|mobile|status|primary_dept_code)\s*=/)
  assert.doesNotMatch(apply, /pushSubjectProjection/)
  assert.match(legacyStart, /providerCode === 'dingtalk'[\s\S]*statusCode: 410/)
  assert.match(peopleClient, /objectScopes: \['organization', 'people'\]/)
  assert.match(connector, /connector-runtime:directory:sync/)
  assert.match(connector, /dingtalk\.default/)
  assert.doesNotMatch(connector, /directory\.dingtalk/)
  assert.match(runtimeClient, /console:directory-profiles:sync/)
  assert.match(runtimeRegistry, /directory\.dingtalk\.profile-sync/)
  assert.match(consoleTenantRuntimeClient, /applyConsoleDingTalkDirectoryProfileCommand[\s\S]*timeoutMs: 20_000/)
  assert.match(tenantRuntimeClient, /timeout: options\.timeoutMs \|\| 10000/)
  assert.match(enrollment, /\{"console:directory-profiles", "sync"/)
  assert.match(seed, /connector-runtime:directory[\s\S]*directory-name-only/)
  assert.match(seed, /console:directory-profiles[\s\S]*real_name[\s\S]*display_name/)
  assert.match(seed, /CREATE TABLE IF NOT EXISTS `service_command_receipt`/)
  assert.match(seed, /connector_runtime_instances/)
  assert.match(seed, /tenantCode[\s\S]*deploymentCode/)
})
