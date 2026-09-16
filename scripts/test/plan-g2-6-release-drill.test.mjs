import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, test } from 'node:test'
import {
  ReleasePlanConfigurationError,
  buildReleaseDrillPlan,
  parseArgs,
  validateDeploymentPlan,
  writePlan
} from '../plan-g2-6-release-drill.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'docs/release/P3-P4-2026-07.release.json'), 'utf8'))

function completeSnapshot() {
  const deploymentId = '11111111-2222-3333-4444-555555555555'
  return {
    releaseId: manifest.releaseId,
    tenant: 'wiztek',
    environment: 'production',
    schema: { businessFactsFingerprint: 'a'.repeat(64) },
    dataRuntime: {
      currentVersion: '0.3.94',
      currentArtifactSha256: 'b'.repeat(64),
      targetArtifactSha256: 'c'.repeat(64),
      signingKeyId: 'f'.repeat(64),
      autoUpdateState: 'pinned'
    },
    platform: { releaseId: 'platform-release-20260710' },
    cloudflare: Object.fromEntries(['console', 'gateway', 'people', 'assets', 'codocs', 'finance', 'workflow', 'aims', 'altoc']
      .map(code => [code, { deploymentId: `${deploymentId}-${code}` }])),
    serviceGrants: { fingerprint: 'd'.repeat(64) },
    policyBundle: { version: 'bundle-20260710', sha256: 'e'.repeat(64) }
  }
}

describe('G2-6 offline release drill planner', () => {
  test('rejects credentials and all execution-shaped arguments', () => {
    for (const argument of ['--token', '--cookie', '--password', '--secret', '--authorization', '--execute', '--deploy', '--rollback']) {
      assert.throws(() => parseArgs([argument, 'value']), ReleasePlanConfigurationError)
    }
  })

  test('locks stage and target-first bridge ordering', () => {
    assert.doesNotThrow(() => validateDeploymentPlan(manifest))
    const reordered = structuredClone(manifest)
    reordered.deploymentPlan.stages.reverse()
    assert.throws(() => validateDeploymentPlan(reordered), /deployment stages/)
    const wrongBridges = structuredClone(manifest)
    wrongBridges.deploymentPlan.stages.find(item => item.code === 'business-bridges').components.reverse()
    assert.throws(() => validateDeploymentPlan(wrongBridges), /business bridges/)
  })

  test('is deterministic and performs only injected local reads', () => {
    const args = parseArgs(['--operator', 'operator-1', '--change-id', 'CHG-100'])
    let reads = 0
    const readFile = (...parameters) => { reads += 1; return readFileSync(...parameters) }
    const first = buildReleaseDrillPlan(args, { rootDir: ROOT, readFile })
    const firstReads = reads
    const second = buildReleaseDrillPlan(args, { rootDir: ROOT, readFile })
    assert.equal(first.confirmationSha256, second.confirmationSha256)
    assert.equal(reads, firstReads * 2)
    assert.equal(first.externalActions, 'none')
    assert.equal(first.executionAuthorized, false)
    assert.equal(first.remoteAnchorsComplete, false)
    assert.equal(first.missingRemoteAnchors.length > 0, true)
  })

  test('source changes alter the confirmation digest', () => {
    const args = parseArgs(['--operator', 'operator-1', '--change-id', 'CHG-100'])
    const baseline = buildReleaseDrillPlan(args, { rootDir: ROOT })
    const changed = buildReleaseDrillPlan(args, {
      rootDir: ROOT,
      readFile(path, encoding) {
        const contents = readFileSync(path, encoding)
        if (String(path).endsWith('data-runtime/internal/updater/updater.go')) return `${contents}\n// changed`
        return contents
      }
    })
    assert.notEqual(changed.confirmationSha256, baseline.confirmationSha256)
  })

  test('complete reviewed snapshot is bound into the plan but never authorizes execution', () => {
    const args = parseArgs(['--operator', 'operator-1', '--change-id', 'CHG-100'])
    const plan = buildReleaseDrillPlan(args, { rootDir: ROOT, snapshot: completeSnapshot() })
    assert.equal(plan.remoteAnchorsComplete, true)
    assert.deepEqual(plan.missingRemoteAnchors, [])
    assert.equal(plan.readyForOperatorReview, false, 'draft release must remain unready')
    assert.equal(plan.executionAuthorized, false)
  })

  test('rejects secret-shaped snapshot fields and mismatched target context', () => {
    const args = parseArgs([])
    assert.throws(
      () => buildReleaseDrillPlan(args, { rootDir: ROOT, snapshot: { ...completeSnapshot(), token: 'must-not-enter-plan' } }),
      /forbidden/
    )
    assert.throws(
      () => buildReleaseDrillPlan(args, { rootDir: ROOT, snapshot: { ...completeSnapshot(), tenant: 'other' } }),
      /does not match/
    )
  })

  test('writes the reviewed plan atomically with mode 0600', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g2-6-plan-'))
    const plan = buildReleaseDrillPlan(parseArgs([]), { rootDir: ROOT })
    const target = writePlan('plan.json', plan, { cwd: dir })
    assert.equal(statSync(target).mode & 0o777, 0o600)
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), plan)
    assert.equal(readFileSync(target, 'utf8').includes('must-not-enter-plan'), false)
  })
})
