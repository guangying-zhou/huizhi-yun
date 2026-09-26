import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { auditReleaseArtifactDescriptor } from './enterprise-preflight.mjs'

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'enterprise-preflight-artifact-'))
  const path = 'deploy/test-env/artifacts/fixture-release-artifact.json'
  const file = join(repo, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ sourceCommit: 'a'.repeat(40) }))
  return { repo, path }
}

function input(path) {
  return { artifacts: { releaseArtifactDescriptor: path } }
}

test('preflight only marks a complete candidate descriptor as fixed and never deployment-ready', () => {
  const { repo, path } = fixture()
  try {
    const result = auditReleaseArtifactDescriptor(input(path), repo, ({ descriptor }) => {
      assert.equal(descriptor.sourceCommit, 'a'.repeat(40))
      return { valid: true, sourceCommit: descriptor.sourceCommit, releaseState: 'candidate', deploymentState: 'not-deployed' }
    })
    assert.deepEqual(result, { artifactFixed: true, deploymentReady: false, errors: [], pending: [] })
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('preflight fails closed for missing descriptors and verifier failures', () => {
  const { repo, path } = fixture()
  try {
    assert.deepEqual(auditReleaseArtifactDescriptor({}, repo), {
      artifactFixed: false, deploymentReady: false, errors: [], pending: ['RELEASE_DESCRIPTOR_MISSING']
    })
    for (const [failure, code] of [
      ['WORKTREE_DIRTY', 'RELEASE_DESCRIPTOR_WORKTREE_DIRTY'],
      ['COMMIT_NOT_PINNED', 'RELEASE_DESCRIPTOR_COMMIT_UNPINNED'],
      ['CHECKOUT_NOT_PINNED_TO_COMMIT', 'RELEASE_DESCRIPTOR_STALE'],
      ['DESCRIPTOR_HASH_DRIFT', 'RELEASE_DESCRIPTOR_STALE']
    ]) {
      const result = auditReleaseArtifactDescriptor(input(path), repo, () => { throw new Error(failure) })
      assert.deepEqual(result, { artifactFixed: false, deploymentReady: false, errors: [code], pending: [] })
    }
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('preflight rejects descriptor paths outside its candidate artifact directory', () => {
  const { repo } = fixture()
  try {
    assert.deepEqual(auditReleaseArtifactDescriptor(input('../.env'), repo, () => {
      throw new Error('must not read arbitrary files')
    }), {
      artifactFixed: false, deploymentReady: false, errors: [], pending: ['RELEASE_DESCRIPTOR_MISSING']
    })
  } finally { rmSync(repo, { recursive: true, force: true }) }
})
