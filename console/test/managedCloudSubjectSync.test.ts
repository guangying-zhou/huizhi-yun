import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Console managed Cloud subject sync', () => {
  test('uses the internal tenant-bound Platform endpoint without runtime token fallback', () => {
    const content = source('server/utils/platformSubjectSync.ts')

    assert.match(content, /new Set\(\['user', 'department', 'committee', 'project'\]\)/)
    assert.doesNotMatch(content, /new Set\(\[[^\]]*'job'/)
    assert.match(content, /config\.activationMode === 'managed-cloud-multitenant'/)
    assert.match(content, /\/api\/platform\/internal\/console\/tenants\/\$\{encodeURIComponent\(config\.tenantCode\)\}\/subjects\/sync/)
    assert.match(content, /Authorization': `Bearer \$\{config\.platformServiceToken\}`/)
    assert.match(content, /x-hzy-internal-principal': 'console-managed-cloud-worker'/)
    assert.match(content, /environment: config\.environment/)
  })

  test('runs subject rebuild and Platform projection inside Tenant Runtime', () => {
    const content = source('server/api/v1/console/directory/sync-jobs/index.post.ts')
    const runtime = source('../data-runtime/internal/apps/directory/console_sync_jobs.go')

    assert.match(content, /startConsoleDirectorySubjectSync\(event/)
    assert.doesNotMatch(content, /pushSubjectProjectionToPlatform|startDirectorySyncJob|directorySyncJobs/)
    assert.match(runtime, /rebuildConsoleSubjectExportsTx/)
    assert.match(runtime, /a\.pushSubjectProjection\(ctx, identity, jobCode\)/)
    assert.match(runtime, /directory_platform_projection_failed/)
  })
})
