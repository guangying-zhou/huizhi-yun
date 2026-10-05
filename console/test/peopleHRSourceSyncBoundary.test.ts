import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { isCanonicalPeopleHRSourceClient } from '../server/utils/peopleHRSourceIdentity.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('Console People HR source service boundary', () => {
  test('service routes require exact capabilities and a bound target app', () => {
    const preview = read('server/api/v1/console/service/directory/hr-sources/dingtalk/department-mappings.get.ts')
    const apply = read('server/api/v1/console/service/directory/hr-sources/dingtalk/department-mappings.post.ts')
    const changes = read('server/api/v1/console/service/directory/hr-sources/dingtalk/department-changes.get.ts')
    const confirmChanges = read('server/api/v1/console/service/directory/hr-sources/dingtalk/department-changes.post.ts')
    const start = read('server/api/v1/console/service/connector-runtime/people-sync-jobs/index.post.ts')
    const cancel = read('server/api/v1/console/service/connector-runtime/people-sync-jobs/[jobId]/cancel.post.ts')
    const retry = read('server/api/v1/console/service/connector-runtime/people-sync-jobs/[jobId]/retry.post.ts')
    assert.match(preview, /console:hr-source-sync:view[\s\S]*requireBoundTargetApp: true/)
    assert.match(apply, /console:hr-source-sync:admin[\s\S]*requireBoundTargetApp: true/)
    assert.match(changes, /console:hr-source-sync:view[\s\S]*requireBoundTargetApp: true/)
    assert.match(confirmChanges, /console:hr-source-sync:admin[\s\S]*requireBoundTargetApp: true/)
    assert.match(confirmChanges, /people\.hr-source-sync\.dingtalk\.department-changes\.apply/)
    assert.match(confirmChanges, /verifyPeopleHRSourceServiceCommand/)
    assert.match(start, /console:hr-source-sync:execute[\s\S]*requireBoundTargetApp: true/)
    assert.match(start, /people\.hr-source-sync\.dingtalk\.jobs\.start[\s\S]*verifyPeopleHRSourceServiceCommand/)
    assert.match(cancel, /people\.hr-source-sync\.dingtalk\.jobs\.cancel[\s\S]*verifyPeopleHRSourceServiceCommand/)
    assert.match(retry, /people\.hr-source-sync\.dingtalk\.jobs\.retry[\s\S]*verifyPeopleHRSourceServiceCommand/)
  })

  test('People job route freezes scopes and cannot invoke the email-matched profile callback', () => {
    const route = read('server/api/v1/console/service/connector-runtime/people-sync-jobs/index.post.ts')
    assert.match(route, /objectScopes: \['organization', 'people'\]/)
    assert.doesNotMatch(route, /objectScopes: verified\.command\.objectScopes/)
  })

  test('mapping mutation verifies source, tenant, deployment, expiry and payload hash before runtime write', () => {
    const source = read('server/utils/hrSourceSyncService.ts')
    assert.match(source, /isCanonicalPeopleHRSourceClient\(actor\)/)
    assert.match(source, /actor\.tenantCode[\s\S]*binding\.tenantId/)
    assert.match(source, /sourceDeploymentCode/)
    assert.match(source, /hashServiceCommandPayload\(command\)/)
    assert.match(source, /verifyServiceCommandRuntimeHeaders/)
  })

  test('only the canonical people.runtime service client may issue HR source commands', () => {
    assert.equal(isCanonicalPeopleHRSourceClient({ appCode: 'people', actorId: 'people.runtime' }), true)
    assert.equal(isCanonicalPeopleHRSourceClient({ appCode: 'people', actorId: 'people.migration' }), false)
    assert.equal(isCanonicalPeopleHRSourceClient({ appCode: 'aims', actorId: 'people.runtime' }), false)
    assert.equal(isCanonicalPeopleHRSourceClient({ appCode: 'people', actorId: 'client:people.runtime' }), false)
  })

  test('legacy browser mutation endpoints fail closed', () => {
    assert.match(read('server/api/v1/console/connector-runtime/people-sync-jobs/index.post.ts'), /statusCode: 410/)
    assert.match(read('server/api/v1/console/directory/sync-jobs/index.post.ts'), /providerCode === 'dingtalk'[\s\S]*statusCode: 410/)
  })

  test('department identity migration stays repeatable on supported MySQL 8 releases', () => {
    const migration = read('docs/sql/Console-SQL-Migration-v2.1-dingtalk-department-identities.sql')
    assert.doesNotMatch(migration, /ALTER TABLE[^;]*ADD COLUMN IF NOT EXISTS/)
    assert.match(migration, /information_schema\.COLUMNS/)
    assert.match(migration, /PREPARE stmt FROM @ddl/)
    assert.match(migration, /path_matched/)
    assert.match(migration, /DROP CHECK `ck_directory_department_identity_origin`/)
  })

  test('People department remap grants are Runtime-audience qualified', () => {
    const seed = read('docs/sql/Console-SQL-Seed-v2.2-people-dingtalk-hr-source-runtime-grants.sql')
    assert.match(seed, /data-runtime:people:hr-source-department-remap/)
    assert.match(seed, /tenant-runtime:people:hr-source-department-remap/)
    assert.match(seed, /UPDATE service_client_grants[\s\S]*status='inactive'[\s\S]*resource_code='people:hr-source-department-remap'/)
    assert.match(seed, /sc\.app_code='people'[\s\S]*sc\.client_code='people\.runtime'/)
    assert.match(seed, /'audience',grant_row\.audience/)
  })
})
