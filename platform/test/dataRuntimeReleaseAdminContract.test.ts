import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Data Runtime release admin contract', () => {
  test('admin synchronizes signed manifests and explicitly approves or rolls back stable', () => {
    const page = source('app/pages/admin/runtime-releases.vue')
    const registry = source('server/utils/dataRuntimeReleaseRegistry.ts')
    const approval = source('server/api/platform/ops/runtime-releases/approve.post.ts')

    assert.match(page, /\/api\/platform\/ops\/runtime-releases\/sync/)
    assert.match(page, /\/api\/platform\/ops\/runtime-releases\/approve/)
    assert.match(page, /confirmRollback/)
    assert.match(registry, /verify\(null, manifestBytes, input\.releasePublicKeyPem, signatureBytes\)/)
    assert.match(registry, /explicit rollback confirmation is required/)
    assert.match(registry, /runtime_release\.rollback/)
    assert.match(approval, /compareDataRuntimeVersions/)
  })

  test('heartbeat and installer await the database-backed approved release', () => {
    const heartbeat = source('server/api/v1/runtime/agent-heartbeat.post.ts')
    const installer = source('server/api/platform/tenant-admin/deployment-settings/install-command.post.ts')

    assert.match(heartbeat, /await dataRuntimeReleaseSettings\(\)/)
    assert.match(heartbeat, /allowDowngrade: approvedRelease\.allowDowngrade/)
    assert.match(installer, /await dataRuntimeReleaseSettings\(\)/)
  })

  test('approval immediately materializes the stable target and live reads bypass caches', () => {
    const registry = source('server/utils/dataRuntimeReleaseRegistry.ts')
    const releaseList = source('server/api/platform/ops/runtime-releases.get.ts')
    const deploymentSettings = source('server/api/platform/tenant-admin/deployment-settings.get.ts')
    const page = source('app/pages/admin/runtime-releases.vue')

    assert.match(registry, /UPDATE tenant_runtime_instances/)
    assert.match(registry, /desired_version = \?/)
    assert.match(registry, /release_signing_key_id = \?/)
    assert.match(registry, /updatedInstances/)
    assert.match(registry, /approvedAt: approvedChannel\.approved_at/)
    assert.match(releaseList, /cache-control.*no-store/)
    assert.match(deploymentSettings, /cache-control.*no-store/)
    assert.match(page, /cache: 'no-store'/)
    assert.match(page, /applyRuntimeReleaseApproval/)
    assert.match(page, /isRuntimeReleaseApprovalObserved/)
  })
})
