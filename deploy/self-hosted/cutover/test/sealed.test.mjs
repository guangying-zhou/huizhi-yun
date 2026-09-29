import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalJson, INPUT_SCHEMA, OBSERVATION_SCHEMA } from '../evidence.mjs'
import { buildSealedArtifacts, verifySealedEvidence } from '../sealed.mjs'
import { runSealCli } from '../seal-cli.mjs'

const now = Date.parse('2026-10-08T12:00:00Z')
const at = offset => new Date(now + offset * 60_000).toISOString()
const hash = value => createHash('sha256').update(value).digest('hex')
function fixture() {
  const key = generateKeyPairSync('ed25519')
  const binding = { tenant: 'C000001', environment: 'prod', cutoverKey: 'cutover-1', targetGeneration: '7',
    instanceId: 'instance-1', runtimeDeployment: 'runtime-1' }
  const report = { schemaVersion: 'enterprise-provider-receipts.v1', binding: { tenant: binding.tenant,
    environment: binding.environment, instanceId: binding.instanceId, runtimeDeployment: binding.runtimeDeployment }, probes: [] }
  const source = { tables: [{ schema: 'hzy_aims', table: 'work_items', count: '1', checksum: '123' }] }
  const make = (kind, minute, result) => ({ schemaVersion: OBSERVATION_SCHEMA, binding, kind,
    observedStart: at(minute), observedEnd: at(minute), collector: 'isolated-collector', result })
  const observations = [make('c2-source-first', -12, source), make('c2-source-second', -7, source),
    make('dump-link', -6, { sha256: 'a'.repeat(64) }), make('provider-report', -5, { sha256: hash(canonicalJson(report)) }),
    make('p-gateway', -2, { routeDisabled: true, workerDisabled: true, routeId: 'route-1', workerVersion: 'v1' }),
    make('p-runtime', -2, { serviceInactive: true, timerInactive: true, unit: 'runtime.service', timer: 'runtime.timer' }),
    make('p-source', -2, source), make('p-nginx', -2, { maintenanceConfig: true, maintenanceResponse: true, serverName: 'example.test' })]
  const input = { schemaVersion: INPUT_SCHEMA, phase: 'p', binding, files: observations.map(row => ({ kind: row.kind, name: `${row.kind}.json` })), approval: null }
  const actors = ['aims', 'assets'].map(app => ({ app, deployment: `C000001-${app}`, artifactSha256: 'b'.repeat(64) }))
  const profile = { version: 'enterprise-cutover-profile.v1', tenant: binding.tenant, environment: binding.environment,
    cutoverKey: binding.cutoverKey, generation: 7, instanceId: binding.instanceId, runtimeDeployment: binding.runtimeDeployment,
    sourceDeployments: { aims: 'C000001-aims', assets: 'C000001-assets' },
    platform: { keyId: 'platform-1', publicKey: key.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url') } }
  const coldArchive = ['altoc', 'finance', 'people', 'webdev'].map(app => ({ app, mode: 'manual',
    name: `${app}-manual.json`, evidenceSha256: hash(canonicalJson({ app, reviewed: true })), reference: `review://${app}` }))
  return { input, observations, report, profile, actors, coldArchive, credential: Buffer.alloc(32, 7), nowMs: now }
}

test('sealed snapshot binds the four M4 materials, provider report and profile key', () => {
  const value = fixture()
  const result = buildSealedArtifacts(value)
  assert.equal(JSON.parse(result.request.seal.payload).ingressDrained, true)
  assert.equal(hash(result.evidenceBytes), result.request.evidenceSha256)
  const evidence = JSON.parse(result.evidenceBytes)
  assert.equal(verifySealedEvidence(evidence, { input: value.input, report: value.report,
    profileKey: result.request.profileKey, nowMs: now }).manifestSha256, evidence.manifestSha256)
  const missing = { ...structuredClone(value), credential: value.credential }; missing.input.files.pop(); missing.observations.pop()
  assert.throws(() => buildSealedArtifacts(missing), /EVIDENCE_FILE_CLOSURE/)
  const reopened = { ...structuredClone(value), credential: value.credential }; reopened.observations[4].result.routeDisabled = false
  assert.throws(() => buildSealedArtifacts(reopened), /EVIDENCE_GATEWAY_ACTIVE/)
  const replaced = { ...structuredClone(value), credential: value.credential }; replaced.report.probes.push({ unexpected: true })
  assert.throws(() => buildSealedArtifacts(replaced), /EVIDENCE_REPORT_BINDING/)
  const wrongInstance = { ...structuredClone(value), credential: value.credential }; wrongInstance.profile.instanceId = 'other'
  assert.throws(() => buildSealedArtifacts(wrongInstance), /EVIDENCE_PROFILE_BINDING/)
  const autoCold = { ...structuredClone(value), credential: value.credential }; autoCold.coldArchive[0].mode = 'automatic'
  assert.throws(() => buildSealedArtifacts(autoCold), /EVIDENCE_COLD_ARCHIVE_MANUAL_REQUIRED/)
})

test('seal CLI reads only protected local material and writes two owner-only artifacts', async t => {
  const value = fixture()
  const directory = mkdtempSync(join(tmpdir(), 'k2e-seal-'))
  const credentialDirectory = mkdtempSync(join(tmpdir(), 'k2e-credential-'))
  t.after(() => { rmSync(directory, { recursive: true, force: true }); rmSync(credentialDirectory, { recursive: true, force: true }) })
  const save = (name, body) => writeFileSync(join(directory, name), canonicalJson(body), { mode: 0o600 })
  save('manifest.json', value.input)
  for (const row of value.observations) save(`${row.kind}.json`, row)
  for (const [name, body] of [['report', value.report], ['profile', value.profile], ['actors', value.actors], ['cold', value.coldArchive]]) save(`${name}.json`, body)
  for (const item of value.coldArchive) save(item.name, { app: item.app, reviewed: true })
  writeFileSync(join(credentialDirectory, 'offline-drain-hmac'), value.credential, { mode: 0o600 })
  const result = await runSealCli(['seal', '--manifest', join(directory, 'manifest.json'), '--report', join(directory, 'report.json'),
    '--profile', join(directory, 'profile.json'), '--actors', join(directory, 'actors.json'), '--cold-archive', join(directory, 'cold.json'),
    '--out-prefix', 'sealed'], { credentialDirectory, nowMs: now })
  assert.equal(result.status, 'sealed')
  assert.equal(statSync(join(directory, 'sealed.evidence.json')).mode & 0o777, 0o600)
  assert.equal(statSync(join(directory, 'sealed.request.json')).mode & 0o777, 0o600)
  assert.equal(JSON.parse(readFileSync(join(directory, 'sealed.request.json'))).evidenceSha256, result.evidenceSha256)
  await assert.rejects(() => runSealCli(['seal', '--manifest', join(directory, 'manifest.json'), '--report', join(directory, 'report.json'),
    '--profile', join(directory, 'profile.json'), '--actors', join(directory, 'actors.json'), '--cold-archive', join(directory, 'cold.json'),
    '--out-prefix', 'sealed'], { credentialDirectory, nowMs: now }), /EEXIST/)
  save(value.coldArchive[0].name, { app: 'altoc', reviewed: false })
  await assert.rejects(() => runSealCli(['seal', '--manifest', join(directory, 'manifest.json'), '--report', join(directory, 'report.json'),
    '--profile', join(directory, 'profile.json'), '--actors', join(directory, 'actors.json'), '--cold-archive', join(directory, 'cold.json'),
    '--out-prefix', 'replaced'], { credentialDirectory, nowMs: now }), /EVIDENCE_COLD_ARCHIVE_FILE_CHANGED/)
})
