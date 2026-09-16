import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, test } from 'node:test'
import {
  buildGatewayPlan,
  executeGatewayPlan,
  GatewayReleaseConfigurationError,
  parseArgs,
  writeEvidence
} from '../manage-tenant-gateway-release.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const lockedManifest = {
  ...JSON.parse(readFileSync(join(ROOT, 'docs/release/P3-P4-2026-07.release.json'), 'utf8')),
  state: 'locked'
}
const deploymentJSON = JSON.stringify([{ id: 'deployment-1', versions: [{ version_id: 'version-1' }] }])

describe('Tenant Gateway versioned release command', () => {
  test('preview runs no command and binds fixed Wrangler/config/routes', () => {
    const args = parseArgs(['--action', 'deploy', '--operator', 'operator-1', '--change-id', 'CHG-1'])
    let calls = 0
    const result = executeGatewayPlan(args, { rootDir: ROOT, runner: () => { calls += 1 } })
    assert.equal(result.mode, 'preview')
    assert.equal(calls, 0)
    assert.equal(result.plan.wranglerVersion, '4.110.0')
    assert.equal(result.plan.workerName, 'hzy-tenant-gateway')
    assert.equal(result.plan.commands.length, 5)
    assert.equal(result.plan.commands.every(item => item.argv.join(' ').includes('4.110.0') || item.code === 'gateway.tests'), true)
  })

  test('rejects sensitive arguments and non-exact rollback IDs', () => {
    assert.throws(() => parseArgs(['--action', 'deploy', '--operator', 'x', '--change-id', 'y', '--token', 'bad']), /forbidden/)
    assert.throws(() => parseArgs(['--action', 'rollback', '--operator', 'x', '--change-id', 'y', '--version-id', 'short']), /exact/)
    assert.throws(() => parseArgs(['--action', 'deploy', '--operator', 'x', '--change-id', 'y', '--version-id', 'version-123']), /only valid/)
  })

  test('rejects draft release and wrong confirmation before the first command', () => {
    const previewArgs = parseArgs(['--action', 'deploy', '--operator', 'operator-1', '--change-id', 'CHG-1'])
    const preview = buildGatewayPlan(previewArgs, { rootDir: ROOT })
    let calls = 0
    assert.throws(
      () => executeGatewayPlan({ ...previewArgs, execute: true, confirm: preview.confirmationSha256 }, { rootDir: ROOT, runner: () => { calls += 1 } }),
      /locked/
    )
    assert.throws(
      () => executeGatewayPlan({ ...previewArgs, execute: true, confirm: 'a'.repeat(64) }, { rootDir: ROOT, manifest: lockedManifest, runner: () => { calls += 1 } }),
      /exactly match/
    )
    assert.equal(calls, 0)
  })

  test('deploy executes tests, dry-run, version reads and deploy in the fixed order', () => {
    const base = parseArgs(['--action', 'deploy', '--operator', 'operator-1', '--change-id', 'CHG-1'])
    const plan = buildGatewayPlan(base, { rootDir: ROOT, manifest: lockedManifest })
    const codes = []
    let index = 0
    const result = executeGatewayPlan({ ...base, execute: true, confirm: plan.confirmationSha256 }, {
      rootDir: ROOT,
      manifest: lockedManifest,
      runner(argv) {
        codes.push(plan.commands[index++].code)
        return { exitCode: 0, stdout: argv.includes('--json') ? deploymentJSON : 'private stdout must not enter evidence' }
      },
      now: () => new Date('2026-07-10T12:00:00.000Z')
    })
    assert.equal(result.exitCode, 0)
    assert.deepEqual(codes, ['gateway.tests', 'gateway.dry_run', 'gateway.deployments.before', 'gateway.deploy', 'gateway.deployments.after'])
    assert.deepEqual(result.evidence.afterDeploymentIds, ['deployment-1', 'version-1'])
    assert.equal(JSON.stringify(result.evidence).includes('private stdout'), false)
    assert.equal(result.evidence.secretMutation, false)
  })

  test('rollback uses only the exact version ID and stops after failure', () => {
    const base = parseArgs([
      '--action', 'rollback', '--version-id', 'version-12345678', '--operator', 'operator-1', '--change-id', 'CHG-2'
    ])
    const plan = buildGatewayPlan(base, { rootDir: ROOT, manifest: lockedManifest })
    assert.equal(plan.commands[1].argv.includes('version-12345678'), true)
    let calls = 0
    const result = executeGatewayPlan({ ...base, execute: true, confirm: plan.confirmationSha256 }, {
      rootDir: ROOT,
      manifest: lockedManifest,
      runner() {
        calls += 1
        if (calls === 1) return { exitCode: 0, stdout: deploymentJSON }
        return { exitCode: 1, stdout: 'private error' }
      }
    })
    assert.equal(calls, 2)
    assert.equal(result.exitCode, 1)
    assert.equal(result.evidence.writeState, 'partial_or_unknown')
    assert.equal(result.evidence.automaticRollback, false)
    assert.equal(JSON.stringify(result.evidence).includes('private error'), false)
  })

  test('writes sanitized evidence with mode 0600', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gateway-release-'))
    const target = writeEvidence('evidence.json', { status: 'passed', deploymentIds: ['id-1'] }, { cwd: dir })
    assert.equal(statSync(target).mode & 0o777, 0o600)
  })
})

