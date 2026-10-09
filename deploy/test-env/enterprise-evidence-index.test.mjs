import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { candidateEvidenceSources, generateEvidenceIndex, verifyEvidenceIndex } from './enterprise-evidence-index.mjs'

function command(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
}

function write(repo, path, value) {
  const file = join(repo, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, value)
}

function fixture({ deployedCandidate = false } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'enterprise-evidence-index-'))
  command(repo, ['init', '--quiet'])
  command(repo, ['config', 'user.email', 'fixture@example.invalid'])
  command(repo, ['config', 'user.name', 'fixture'])
  const sources = candidateEvidenceSources.map((source, index) => ({ ...source, path: `evidence/${index}.txt` }))
  for (const source of sources) write(repo, source.path, `${source.id}\n`)
  if (deployedCandidate) {
    sources[0].path = 'evidence/candidate.json'
    write(repo, sources[0].path, JSON.stringify({ candidateOnly: true, deployed: true }))
  }
  command(repo, ['add', '.'])
  command(repo, ['commit', '--quiet', '-m', 'fixture'])
  return { repo, commit: command(repo, ['rev-parse', 'HEAD']), sources }
}

test('generates and verifies a candidate-only evidence index from isolated evidence', () => {
  const { repo, commit, sources } = fixture()
  try {
    const index = generateEvidenceIndex({ repo, commit, sources })
    assert.equal(index.releaseState, 'candidate')
    assert.equal(index.deploymentState, 'not-deployed')
    assert.equal(index.evidence.length, sources.length)
    for (const entry of index.evidence) {
      assert.equal(entry.testedCommit, commit)
      assert.match(entry.source.sha256, /^[a-f0-9]{64}$/)
      assert.equal(entry.deploymentState, 'not-deployed')
      assert.ok(entry.boundary.proves.length)
      assert.ok(entry.boundary.excludes.length)
    }
    assert.deepEqual(verifyEvidenceIndex({ repo, index, sources }), { valid: true, sourceCommit: commit, releaseState: 'candidate', deploymentState: 'not-deployed', evidenceCount: sources.length })
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('fails closed for missing files, dirty trees, symbolic commits and hash drift', () => {
  const { repo, commit, sources } = fixture()
  try {
    assert.throws(() => generateEvidenceIndex({ repo, commit: 'HEAD', sources }), /COMMIT_NOT_PINNED/)
    const missing = sources.map(source => ({ ...source }))
    missing[0].path = 'evidence/missing.txt'
    assert.throws(() => generateEvidenceIndex({ repo, commit, sources: missing }), /EVIDENCE_FILE_MISSING/)
    const index = generateEvidenceIndex({ repo, commit, sources })
    index.evidence[0].source.sha256 = 'a'.repeat(64)
    assert.throws(() => verifyEvidenceIndex({ repo, index, sources }), /EVIDENCE_HASH_DRIFT/)
    write(repo, 'untracked.txt', 'dirty\n')
    assert.throws(() => generateEvidenceIndex({ repo, commit, sources }), /WORKTREE_DIRTY/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('rejects mock-as-real and candidate-as-deployed claims before comparing evidence', () => {
  const { repo, commit, sources } = fixture()
  try {
    const index = generateEvidenceIndex({ repo, commit, sources })
    index.evidence[0].execution = { mode: 'isolated', environment: 'real', mocked: true }
    assert.throws(() => verifyEvidenceIndex({ repo, index, sources }), /MOCK_LABELED_REAL/)
    const deployed = generateEvidenceIndex({ repo, commit, sources })
    deployed.deploymentState = 'deployed'
    assert.throws(() => verifyEvidenceIndex({ repo, index: deployed, sources }), /CANDIDATE_DEPLOYMENT_FORBIDDEN/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('rejects a selected candidate receipt that claims deployment', () => {
  const { repo, commit, sources } = fixture({ deployedCandidate: true })
  try {
    assert.throws(() => generateEvidenceIndex({ repo, commit, sources }), /CANDIDATE_DEPLOYMENT_FORBIDDEN/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('tool source does not read process environment', () => {
  const source = readFileSync(new URL('./enterprise-evidence-index.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /process\.env/)
})
