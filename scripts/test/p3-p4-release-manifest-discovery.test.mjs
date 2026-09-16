import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

function validate(t, manifests) {
  const root = mkdtempSync(resolve(tmpdir(), 'p3-p4-discovery-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(resolve(root, 'scripts'))
  mkdirSync(resolve(root, 'docs/release'), { recursive: true })
  const script = resolve(root, 'scripts/validate-p3-p4-release-contract.mjs')
  copyFileSync(resolve(import.meta.dirname, '../validate-p3-p4-release-contract.mjs'), script)
  for (const [name, manifest] of Object.entries(manifests)) {
    writeFileSync(resolve(root, 'docs/release', name), typeof manifest === 'string' ? manifest : JSON.stringify(manifest))
  }
  const result = spawnSync(process.execPath, [script, '--allow-incomplete'], { cwd: root, encoding: 'utf8' })
  assert.ifError(result.error)
  return { status: result.status, output: result.stdout + result.stderr }
}

test('unrelated release types do not activate the archived P3/P4 contract', (t) => {
  const result = validate(t, {
    'P3-P4-old.release.json': { releaseId: 'P3-P4-old', state: 'superseded' },
    'POLICY-STORE-current.release.json': { schemaVersion: 1, state: 'locked' }
  })
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /no active release; 1 archived/)
})

test('unrelated releases cannot satisfy a missing P3/P4 manifest', (t) => {
  const result = validate(t, { 'POLICY-STORE-current.release.json': { state: 'locked' } })
  assert.equal(result.status, 1)
  assert.match(result.output, /no P3-P4-\*\.release\.json/)
})

test('malformed P3/P4 JSON still fails validation', (t) => {
  const result = validate(t, { 'P3-P4-new.release.json': '{' })
  assert.equal(result.status, 1)
  assert.match(result.output, /invalid manifest JSON/)
})

test('active incomplete manifests report missing files instead of reading a directory', (t) => {
  const result = validate(t, {
    'P3-P4-new.release.json': { schemaVersion: 2, releaseId: 'P3-P4-new', state: 'locked', dataRuntime: { versionFile: 'docs' } }
  })
  assert.equal(result.status, 1)
  assert.match(result.output, /missing data-runtime version file: docs/)
  assert.match(result.output, /missing Platform subscription seed/)
  assert.doesNotMatch(result.output, /EISDIR|TypeError/)
})

test('multiple active P3/P4 batches remain an error', (t) => {
  const result = validate(t, {
    'P3-P4-one.release.json': { state: 'locked' },
    'P3-P4-two.release.json': { state: 'draft' }
  })
  assert.equal(result.status, 1)
  assert.match(result.output, /multiple active releases/)
})
