import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, lstatSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildLocalPackage, canonicalJson, parseCanonicalJson, validatePackageInput, evaluateTime, activationDeadline, FIXED_LIMITS, INPUT_SCHEMA, OBSERVATION_SCHEMA } from '../evidence.mjs'
import { readProtectedFile, writeProtectedNew } from '../protected-files.mjs'
import { collectObservations } from '../collectors.mjs'
import { runCli, safeErrorCode } from '../cli.mjs'
import { makeFixture } from './make-fixture.mjs'

const iso = minutes => new Date(Date.parse('2026-10-08T12:00:00Z') + minutes * 60_000).toISOString()
const baseNow = Date.parse(iso(12))
const binding = Object.freeze({ tenant: 'C000001', environment: 'prod', cutoverKey: 'synthetic-window-1', targetGeneration: '1', instanceId: 'synthetic-instance', runtimeDeployment: 'c000001-prod-tenant-runtime' })
const tables = [{ schema: 'hzy_aims', table: 'work_items', count: '2', checksum: '123' }, { schema: 'hzy_assets', table: 'ip_assets', count: '1', checksum: '456' }]
const hash = 'a'.repeat(64)
function observation(kind, start, end = start, result) {
  return { schemaVersion: OBSERVATION_SCHEMA, binding, kind, observedStart: iso(start), observedEnd: iso(end), collector: 'synthetic-fixture', result: result ?? (kind.includes('source') ? { tables: structuredClone(tables) } : kind.endsWith('gateway') ? { routeDisabled: true, workerDisabled: true, routeId: 'route-fixture', workerVersion: 'version-fixture' } : kind.endsWith('runtime') ? { serviceInactive: true, timerInactive: true, unit: 'fixture.service', timer: 'fixture.timer' } : kind.endsWith('nginx') ? { maintenanceConfig: true, maintenanceResponse: true, serverName: 'fixture.invalid' } : { sha256: hash }) }
}
function fixture(phase = 'p') {
  const values = phase === 'p' ? [
    observation('c2-source-first', 0), observation('c2-source-second', 5),
    observation('dump-link', 7), observation('provider-report', 8),
    observation('p-gateway', 10), observation('p-runtime', 10), observation('p-source', 10, 11), observation('p-nginx', 11)
  ] : [
    observation('c2-source-second', 5), observation('q-gateway', 13), observation('q-runtime', 13), observation('q-source', 13, 14), observation('q-nginx', 14)
  ]
  return { input: { schemaVersion: INPUT_SCHEMA, phase, binding, files: values.map(value => ({ kind: value.kind, name: `${value.kind}.json` })), approval: phase === 'p' ? null : { payloadSha256: hash, approvedAt: iso(12), pEarliestStart: iso(10) } }, values }
}
function protectedFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'k2e-fixture-'))
  const cleanup = () => rmSync(directory, { recursive: true, force: true })
  return { directory, cleanup, save(name, value) { const path = join(directory, name); writeFileSync(path, canonicalJson(value), { mode: 0o600 }); return path } }
}

test('canonical bytes are stable and reject duplicate keys, non-NFC and float values', () => {
  assert.equal(canonicalJson({ z: 1, a: 'é' }), '{"a":"é","z":1}\n')
  assert.deepEqual(parseCanonicalJson(Buffer.from(canonicalJson({ z: 1, a: 'é' }))), { a: 'é', z: 1 })
  assert.throws(() => parseCanonicalJson(Buffer.from('{"a":1,"a":2}\n')), /EVIDENCE_NON_CANONICAL_JSON/)
  assert.throws(() => canonicalJson({ a: 'e\u0301' }), /EVIDENCE_NON_NFC_STRING/)
  assert.throws(() => canonicalJson({ a: 1.5 }), /EVIDENCE_NON_INTEGER_NUMBER/)
})

test('P package is only a local structure validation, never live drain approval', () => {
  const { input, values } = fixture()
  const draft = buildLocalPackage(input, values, baseNow)
  const validated = buildLocalPackage(input, values, baseNow, Buffer.alloc(32, 7))
  assert.equal(draft.status, 'draft')
  assert.equal(validated.status, 'validated-local-structure')
  assert.equal(validated.localMac.alg, 'HS256')
  assert.equal('ingressDrained' in validated, false)
  assert.equal('seal' in validated, false)
  assert.equal(buildLocalPackage(input, values, baseNow, Buffer.alloc(32, 7)).localMac.signature, validated.localMac.signature)
  assert.equal(validated.entries.length, 8)
})

test('P rejects missing, tampered, active and wrong-bound evidence', () => {
  const { input, values } = fixture()
  assert.throws(() => validatePackageInput({ ...input, files: input.files.slice(1) }, values, baseNow), /EVIDENCE_FILE_CLOSURE/)
  const changed = structuredClone(values); changed[6].result.tables[0].count = '3'
  assert.throws(() => validatePackageInput(input, changed, baseNow), /EVIDENCE_SOURCE_CHANGED/)
  const active = structuredClone(values); active[4].result.routeDisabled = false
  assert.throws(() => validatePackageInput(input, active, baseNow), /EVIDENCE_GATEWAY_ACTIVE/)
  const other = structuredClone(values); other[0].binding.tenant = 'C000002'
  assert.throws(() => validatePackageInput(input, other, baseNow), /EVIDENCE_OBSERVATION_BINDING/)
  const shortInterval = structuredClone(values); shortInterval[1].observedStart = iso(4)
  assert.throws(() => validatePackageInput(input, shortInterval, baseNow), /EVIDENCE_C2_INTERVAL/)
  const numeric = structuredClone(values); numeric[6].result.tables[0].count = 2
  assert.throws(() => validatePackageInput(input, numeric, baseNow), /EVIDENCE_TABLE_VALUE/)
  const extraSource = structuredClone(values); extraSource[6].result.unreviewed = true
  assert.throws(() => validatePackageInput(input, extraSource, baseNow), /EVIDENCE_SOURCE_SHAPE/)
  const extraLink = structuredClone(values); extraLink[2].result.unreviewed = true
  assert.throws(() => validatePackageInput(input, extraLink, baseNow), /EVIDENCE_LINK_SHAPE/)
})

test('P/Q age uses earliest observation, not recent completion or signing time', () => {
  const p = fixture()
  const staleP = structuredClone(p.values); staleP[4].observedStart = iso(8); staleP[4].observedEnd = iso(20)
  assert.throws(() => evaluateTime(p.input, validatePackageInput(p.input, staleP, Date.parse(iso(21))).metadata, Date.parse(iso(21))), /EVIDENCE_COLLECTION_SPAN/)
  assert.throws(() => evaluateTime(p.input, validatePackageInput(p.input, p.values, baseNow).metadata, Date.parse(iso(41))), /EVIDENCE_P_EXPIRED/)
  const q = fixture('q')
  const result = evaluateTime(q.input, validatePackageInput(q.input, q.values, Date.parse(iso(15))).metadata, Date.parse(iso(15)))
  assert.equal(result.expiresAt, iso(23))
  assert.throws(() => evaluateTime(q.input, validatePackageInput(q.input, q.values, Date.parse(iso(24))).metadata, Date.parse(iso(24))), /EVIDENCE_Q_EXPIRED/)
  assert.equal(activationDeadline({ pEarliestStart: iso(10), qEarliestStart: iso(13), approvedAt: iso(12), checkSignedAt: iso(15) }, Date.parse(iso(16))), iso(17))
  assert.throws(() => activationDeadline({ pEarliestStart: iso(10), qEarliestStart: iso(13), approvedAt: iso(12), checkSignedAt: iso(16) }, Date.parse(iso(19))), /EVIDENCE_ACTIVATION_EXPIRED/)
  assert.throws(() => activationDeadline({ pEarliestStart: iso(10), qEarliestStart: iso(13), approvedAt: iso(12), checkSignedAt: iso(15) }, Number.NaN), /EVIDENCE_NOW/)
  assert.throws(() => activationDeadline({ pEarliestStart: iso(10), qEarliestStart: iso(13), approvedAt: iso(12), checkSignedAt: iso(15) }, Number.POSITIVE_INFINITY), /EVIDENCE_NOW/)
  const future = structuredClone(q.values); future[4].observedEnd = iso(20)
  assert.throws(() => validatePackageInput(q.input, future, Date.parse(iso(15))), /EVIDENCE_OBSERVATION_TIME/)
  const lateC2 = structuredClone(q.values); lateC2[0].observedStart = iso(18); lateC2[0].observedEnd = iso(18)
  assert.throws(() => validatePackageInput(q.input, lateC2, Date.parse(iso(20))), /EVIDENCE_STAGE_ORDER/)
  const afterP = structuredClone(q.values); afterP[0].observedStart = iso(11); afterP[0].observedEnd = iso(11)
  assert.throws(() => validatePackageInput(q.input, afterP, Date.parse(iso(15))), /EVIDENCE_STAGE_ORDER/)
  assert.equal(FIXED_LIMITS.clockSkewMs, 30_000)
})

test('synthetic fixture generator and CLI work together without a credential', async t => {
  const f = protectedFixture(); t.after(f.cleanup)
  assert.equal(makeFixture(f.directory).count, 8)
  const result = await runCli(['build', '--manifest', join(f.directory, 'manifest.json'), '--out', 'draft.json', '--mode', 'draft'])
  assert.equal(result.status, 'draft')
  assert.equal(lstatSync(join(f.directory, 'draft.json')).mode & 0o777, 0o600)
})

test('fixture collector obeys the narrow port and one call per requested kind', async () => {
  const { input, values } = fixture()
  const calls = []
  const result = await collectObservations({ collect(kind, receivedBinding, name) {
    calls.push([kind, name]); assert.deepEqual(receivedBinding, binding)
    return Buffer.from(canonicalJson(values.find(item => item.kind === kind)))
  } }, binding, input.files)
  assert.deepEqual(calls.map(item => item[0]), input.files.map(item => item.kind))
  assert.equal(result.length, 8)
})

test('CLI rejects duplicate manifest before any read; collector stops at cumulative byte limit', async t => {
  const f = protectedFixture(); t.after(f.cleanup)
  const { input } = fixture()
  const duplicate = structuredClone(input); duplicate.files[1] = { ...duplicate.files[0] }
  const manifest = f.save('duplicate.json', duplicate)
  let called = 0
  await assert.rejects(() => runCli(['build', '--manifest', manifest, '--out', 'out.json', '--mode', 'draft'], { collector: { collect() { called++; throw Error('unexpected read') } }, nowMs: baseNow }), /EVIDENCE_FILE_CLOSURE/)
  assert.equal(called, 0)
  const raw = Buffer.from(canonicalJson({ a: 1 }))
  await assert.rejects(() => collectObservations({ collect() { called++; return raw } }, binding, [{ kind: 'first', name: 'a' }, { kind: 'second', name: 'b' }, { kind: 'third', name: 'c' }], { initialBytes: 1, maxBytes: 1 + raw.length + 1 }), /EVIDENCE_PACKAGE_TOO_LARGE/)
  assert.equal(called, 2) // Third file is not collected after the budget is exceeded.
})

test('protected file I/O rejects symlink, replacement target, loose mode and hides paths', async t => {
  const f = protectedFixture(); t.after(f.cleanup)
  const path = f.save('material.json', { a: 1 })
  assert.equal(readProtectedFile(path).toString(), canonicalJson({ a: 1 }))
  symlinkSync(path, join(f.directory, 'link.json'))
  assert.throws(() => readProtectedFile(join(f.directory, 'link.json')), /EVIDENCE_FILE_UNPROTECTED/)
  chmodSync(path, 0o644)
  assert.throws(() => readProtectedFile(path), /EVIDENCE_FILE_UNPROTECTED/)
  chmodSync(path, 0o600)
  const output = join(f.directory, 'out.json')
  writeProtectedNew(output, canonicalJson({ b: 2 }))
  assert.equal(lstatSync(output).mode & 0o777, 0o600)
  assert.throws(() => writeProtectedNew(output, 'other'), /EEXIST/)
  assert.equal(safeErrorCode(new Error(`open ${path}: secret-credential`)), 'EVIDENCE_IO_FAILURE')
})

test('CLI only reads protected synthetic files; credential is systemd-directory only', async t => {
  const f = protectedFixture(); t.after(f.cleanup)
  const { input, values } = fixture()
  const manifest = f.save('manifest.json', input)
  for (const value of values) f.save(`${value.kind}.json`, value)
  const draft = await runCli(['build', '--manifest', manifest, '--out', 'draft.json', '--mode', 'draft'], { nowMs: baseNow })
  assert.equal(draft.status, 'draft')
  assert.match(readFileSync(join(f.directory, 'draft.json'), 'utf8'), /not-live-drain-proof/)
  await assert.rejects(() => runCli(['build', '--manifest', manifest, '--out', 'blocked.json', '--mode', 'validated'], { nowMs: baseNow, credentialDirectory: join(f.directory, 'missing') }), /ENOENT|EVIDENCE_DIRECTORY_UNPROTECTED/)
  const credentialDir = mkdtempSync(join(tmpdir(), 'k2e-credential-fixture-')); t.after(() => rmSync(credentialDir, { recursive: true, force: true }))
  writeFileSync(join(credentialDir, 'offline-drain-hmac'), Buffer.alloc(32, 9), { mode: 0o600 })
  const valid = await runCli(['build', '--manifest', manifest, '--out', 'validated.json', '--mode', 'validated'], { nowMs: baseNow, credentialDirectory: credentialDir })
  assert.equal(valid.status, 'validated-local-structure')
  assert.equal(readFileSync(join(f.directory, 'validated.json'), 'utf8').includes(Buffer.alloc(32, 9).toString('hex')), false)
})
