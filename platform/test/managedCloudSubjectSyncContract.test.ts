import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

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

describe('managed Cloud Console subject sync contract', () => {
  test('requires the trusted Console principal and binds writes to an active tenant deployment', () => {
    const content = source('server/api/platform/internal/console/tenants/[tenantCode]/subjects/sync.post.ts')

    assertBefore(content, 'platformInternalPrincipal !== \'console-managed-cloud-worker\'', 'readBody<Record<string, unknown>>')
    assert.match(content, /WHERE tenant_code = \?[\s\S]*app_code = 'console'/)
    assert.match(content, /environment = \?/)
    assert.match(content, /deployment\.status !== 'active'/)
    assertBefore(content, 'const deployment = await queryRow', 'applySubjectProjectionSync({')
    assert.match(content, /tenantCode: deployment\.tenant_code/)
    assert.match(content, /deploymentId: deployment\.id/)
  })

  test('runtime and managed Cloud endpoints share one projection transaction', () => {
    const runtimeEndpoint = source('server/api/v1/runtime/subjects/sync.post.ts')
    const internalEndpoint = source('server/api/platform/internal/console/tenants/[tenantCode]/subjects/sync.post.ts')
    const projectionSync = source('server/utils/subjectProjectionSync.ts')

    assert.match(runtimeEndpoint, /applySubjectProjectionSync/)
    assert.match(internalEndpoint, /applySubjectProjectionSync/)
    assert.match(projectionSync, /withTransaction/)
    assert.match(projectionSync, /tenant_subject_memberships/)
    assert.match(projectionSync, /reported_directory_snapshot_hash/)
    assert.match(runtimeEndpoint, /resetMemberships: body\.resetMemberships/)
    assert.match(runtimeEndpoint, /finalize: body\.finalize/)
    assert.match(projectionSync, /if \(resetMemberships\)/)
    assert.match(projectionSync, /if \(finalize\)/)
    assert.match(projectionSync, /directory_sync_status = 'syncing'/)
    assert.match(projectionSync, /'user', 'department', 'committee', 'job', 'project'/)
    assert.match(projectionSync, /item\.subjectType === 'project'/)
    assert.match(projectionSync, /subject_type = 'job'[\s\S]*external_ref = \?/)
  })

  test('project projection converges legacy project-as-job rows without broad job rewrites', () => {
    const migration = source('../platform/docs/sql/HZY-Platform-SQL-Migration-v2.30-project-subject-semantics.sql')

    assert.match(migration, /legacy_job\.subject_type = 'job'/)
    assert.match(migration, /legacy_job\.external_ref = SHA2\(CONCAT\('console:project:', legacy_job\.subject_code\), 256\)/)
    assert.match(migration, /membership\.status = 'inactive'/)
    assert.doesNotMatch(migration, /UPDATE tenant_subjects\s+SET subject_type = 'project'/)
  })

  test('structural subjects are not duplicated as membership children', () => {
    const projectionSync = source('server/utils/subjectProjectionSync.ts')
    const subjectsManager = source('app/components/console/SubjectsManager.vue')

    assert.match(
      projectionSync,
      /function parentMembershipFromItem[\s\S]*?item\.subjectType !== 'user'[\s\S]*?return null/
    )
    assert.match(
      subjectsManager,
      /const subject = subjectById\.value\.get\(membership\.subjectId\)[\s\S]*?subject\.subjectType !== 'user'[\s\S]*?continue/
    )
  })

  test('unchanged runtime snapshots stop before chunk transaction writes', () => {
    const route = source('server/api/v1/runtime/subjects/sync.post.ts')
    const deployment = source('server/utils/platform.ts')

    assert.match(route, /deployment\.reported_directory_snapshot_hash === snapshotHash/)
    assert.match(route, /deployment\.directory_sync_status === 'healthy'/)
    assert.match(route, /unchanged: true/)
    assertBefore(route, 'unchanged: true', 'applySubjectProjectionSync({')
    assert.match(deployment, /reported_directory_snapshot_hash, directory_sync_status/)
  })
})
