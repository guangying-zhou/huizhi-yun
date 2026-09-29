import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { generateReleaseArtifactDescriptor, verifyReleaseArtifactDescriptor } from './release-artifact-descriptor.mjs'
import { releaseSourcePaths, releaseBuildFiles } from '../../enterprise/scripts/manifest-artifacts.mjs'

function command(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
}

function write(repo, path, value) {
  const file = join(repo, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, value)
}

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'enterprise-artifact-'))
  command(repo, ['init', '--quiet'])
  command(repo, ['config', 'user.email', 'fixture@example.invalid'])
  command(repo, ['config', 'user.name', 'fixture'])
  for (const path of releaseSourcePaths) write(repo, `${path}/fixture.txt`, 'source fixture\n')
  for (const path of releaseBuildFiles) write(repo, path, 'build fixture\n')
  const catalog = { permissionCodes: ['aims:products:view'], modules: [] }
  const catalogHash = createHash('sha256').update('{"modules":[],"permissionCodes":["aims:products:view"]}').digest('hex')
  write(repo, 'enterprise/app.manifest.json', JSON.stringify({ appCode: 'enterprise', composition: { permissionCatalog: catalog, permissionCatalogHash: catalogHash } }))
  write(repo, 'data-runtime/VERSION', '0.3.219-test\n')
  write(repo, 'deploy/test-env/artifacts/C000001.enterprise-migration-plan.json', JSON.stringify({ Version: 'enterprise-shadow-copy.v1', ReviewHash: 'a'.repeat(64), Tables: [] }))
  write(repo, 'deploy/cloudflare/tenant-gateway/wrangler.jsonc', JSON.stringify({ triggers: { crons: ['*/2 * * * *'] }, vars: { HZY_ALLOWED_TENANTS: 'C000001' } }))
  write(repo, 'deploy/cloudflare/tenant-gateway/src/index.js', 'export default { scheduled() {} }\n')
  write(repo, 'deploy/test-env/artifacts/C000001.enterprise-host-full-candidate-20260914.json', JSON.stringify({ observedRollbackVersion: '20cf726f-75e0-4ab3-abb0-574efbff6c1a' }))
  command(repo, ['add', '.'])
  command(repo, ['commit', '--quiet', '-m', 'fixture'])
  return { repo, commit: command(repo, ['rev-parse', 'HEAD']) }
}

test('generates and verifies a pinned candidate descriptor from an isolated repository', () => {
  const { repo, commit } = fixture()
  try {
    const descriptor = generateReleaseArtifactDescriptor({ repo, commit })
    assert.equal(descriptor.releaseState, 'candidate')
    assert.equal(descriptor.deploymentState, 'not-deployed')
    assert.equal(descriptor.enterpriseHost.commit, commit)
    assert.equal(descriptor.dataRuntime.commit, commit)
    assert.equal(descriptor.sources.console.commit, commit)
    assert.equal(descriptor.sources['deploy/cloudflare/tenant-gateway'].treeSha1, command(repo, ['rev-parse', `${commit}:deploy/cloudflare/tenant-gateway`]))
    assert.equal(descriptor.buildFiles['deploy/test-env/enterprise-host-routes.mjs'].blobSha1, command(repo, ['rev-parse', `${commit}:deploy/test-env/enterprise-host-routes.mjs`]))
    assert.deepEqual(descriptor.gateway.crons, ['*/2 * * * *'])
    assert.deepEqual(verifyReleaseArtifactDescriptor({ repo, descriptor }), { valid: true, sourceCommit: commit, releaseState: 'candidate', deploymentState: 'not-deployed' })
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('candidate cannot omit or alter Console or Gateway transitive input bindings', () => {
  const { repo, commit } = fixture()
  try {
    const descriptor = generateReleaseArtifactDescriptor({ repo, commit })
    for (const path of ['console', 'deploy/cloudflare/tenant-gateway']) {
      const missing = structuredClone(descriptor)
      delete missing.sources[path]
      assert.throws(() => verifyReleaseArtifactDescriptor({ repo, descriptor: missing }), /DESCRIPTOR_HASH_DRIFT/)
    }
    const changed = structuredClone(descriptor)
    changed.buildFiles['deploy/test-env/enterprise-host-routes.mjs'].blobSha1 = 'b'.repeat(40)
    assert.throws(() => verifyReleaseArtifactDescriptor({ repo, descriptor: changed }), /DESCRIPTOR_HASH_DRIFT/)
    write(repo, 'console/fixture.txt', 'uncommitted shell change\n')
    assert.throws(() => verifyReleaseArtifactDescriptor({ repo, descriptor }), /WORKTREE_DIRTY/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('fails closed for dirty trees, missing required files, symbolic commits and descriptor drift', () => {
  const { repo, commit } = fixture()
  try {
    assert.throws(() => generateReleaseArtifactDescriptor({ repo, commit: 'HEAD' }), /COMMIT_NOT_PINNED/)
    const descriptor = generateReleaseArtifactDescriptor({ repo, commit })
    descriptor.gateway.configSha256 = 'b'.repeat(64)
    assert.throws(() => verifyReleaseArtifactDescriptor({ repo, descriptor }), /DESCRIPTOR_HASH_DRIFT/)
    write(repo, 'enterprise/app.manifest.json', '{}')
    assert.throws(() => generateReleaseArtifactDescriptor({ repo, commit }), /WORKTREE_DIRTY/)
    command(repo, ['checkout', '--', '.'])
    rmSync(join(repo, 'data-runtime/VERSION'))
    command(repo, ['add', '--all'])
    command(repo, ['commit', '--quiet', '-m', 'missing runtime version'])
    assert.throws(() => generateReleaseArtifactDescriptor({ repo, commit: command(repo, ['rev-parse', 'HEAD']) }), /REQUIRED_FILE_MISSING/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('tool source does not read process environment or accept secret-bearing gateway configuration', () => {
  const source = readFileSync(new URL('./release-artifact-descriptor.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /process\.env/)
  const { repo, commit } = fixture()
  try {
    write(repo, 'deploy/cloudflare/tenant-gateway/wrangler.jsonc', JSON.stringify({ triggers: { crons: ['*/2 * * * *'] }, vars: { HZY_TEST_SECRET: 'not-allowed' } }))
    command(repo, ['add', '.'])
    command(repo, ['commit', '--quiet', '-m', 'unsafe config'])
    const unsafe = command(repo, ['rev-parse', 'HEAD'])
    assert.notEqual(unsafe, commit)
    assert.throws(() => generateReleaseArtifactDescriptor({ repo, commit: unsafe }), /GATEWAY_CONFIG_SENSITIVE_FIELD_FORBIDDEN/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})
