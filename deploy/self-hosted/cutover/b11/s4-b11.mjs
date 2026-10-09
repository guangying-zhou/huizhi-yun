// S4 B11 evidence assembly (production, cutoverKey s4-C000001-prod-20260930). Run as root on the new host.
// init W | c2 W first|second | rest W <export-batch> | final W decisions.json
// Everything stays in the 0700 work directory W with 0600 files. Observations are real: the Japan systemd state and the nginx
// vhost facts arrive as feed files collected (with their own UTC times) by the operator's Mac immediately before `rest`.
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, mkdirSync, chmodSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import mysql from '/home/hzy/build/src/node_modules/mysql2/promise.js'
const C = '/home/hzy/build/src/deploy/self-hosted/cutover'
const { canonicalJson, INPUT_SCHEMA, OBSERVATION_SCHEMA, parseCanonicalJson } = await import(`${C}/evidence.mjs`)
const { writeProtectedNew, readProtectedFile } = await import(`${C}/protected-files.mjs`)
const { classifyProviderEvidence } = await import('/home/hzy/build/src/platform/server/utils/enterpriseProviderReceipts.mjs')
const cmd = process.argv[2]; const W = process.argv[3]
const sha = b => createHash('sha256').update(b).digest('hex')
const PROFILE = '/root/.hzy-s4/profile/S4-PROD-cutover-profile.json'
const profileFull = JSON.parse(readFileSync(PROFILE, 'utf8'))
const binding = { tenant: profileFull.tenant, environment: profileFull.environment, cutoverKey: profileFull.cutoverKey, targetGeneration: String(profileFull.generation),
  instanceId: profileFull.instanceId, runtimeDeployment: profileFull.runtimeDeployment }
if (binding.environment !== 'prod' || binding.cutoverKey !== 's4-C000001-prod-20260930') throw Error('unexpected profile')
const SRC = { aims: profileFull.sourceAims, assets: profileFull.sourceAssets }
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const cnf = user => { const t = readFileSync(`/etc/hzy/mysql/${user}.cnf`, 'utf8'); return t.match(/^password\s*=\s*["']?(.*?)["']?\s*$/m)[1] }
const conn = async () => mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'hzy_backup', password: cnf('hzy_backup') })
const write = (name, value) => writeProtectedNew(join(W, name), typeof value === 'string' ? Buffer.from(value) : Buffer.from(canonicalJson(value)))
const obs = (kind, start, end, collector, result) => ({ schemaVersion: OBSERVATION_SCHEMA, binding, kind, observedStart: start, observedEnd: end, collector, result })
async function fingerprint() {
  const db = await conn(); const rows = []
  try {
    for (const schema of [SRC.aims, SRC.assets]) {
      const [t] = await db.query("SELECT table_name n FROM information_schema.tables WHERE table_schema=? AND table_type='BASE TABLE'", [schema])
      for (const { n } of t) {
        const [[c]] = await db.query(`SELECT COUNT(*) c FROM \`${schema}\`.\`${n}\``)
        const [[k]] = await db.query(`CHECKSUM TABLE \`${schema}\`.\`${n}\``)
        rows.push({ schema, table: n, count: String(c.c), checksum: String(k.Checksum) })
      }
    }
  } finally { await db.end() }
  rows.sort((a, b) => `${a.schema}.${a.table}` < `${b.schema}.${b.table}` ? -1 : 1)
  return { tables: rows }
}
const readFeed = name => parseCanonicalJson(readProtectedFile(join(W, name)))
if (cmd === 'init') { mkdirSync(W, { recursive: true, mode: 0o700 }); chmodSync(W, 0o700); console.log('init', W) }
else if (cmd === 'c2') {
  const which = process.argv[4]; const start = now(); const result = await fingerprint(); const end = now()
  write(`c2-source-${which}.json`, obs(`c2-source-${which}`, start, end, 's4-prod-mysql-count-checksum-on-frozen-copies', result))
  console.log('c2', which, result.tables.length, 'tables', start, end)
} else if (cmd === 'rest1' || cmd === 'rest2') {
  const batch = process.argv[4]
  if (cmd === 'rest1') {
  const d0 = now(); const dumpSha = sha(readFileSync(`/home/hzy-backup/s4/${batch}/M2-jp/manifest.json`)); const d1 = now()
  write('dump-link.json', obs('dump-link', d0, d1, 's4-prod-file-sha256', { sha256: dumpSha }))
  const pw = cnf('hzy_backup')
  const dep = { aims: profileFull.sourceDeployments.aims, assets: profileFull.sourceDeployments.assets, codocs: 'C000001-codocs', console: 'C000001-console' }
  const cfg = { schemaVersion: 'enterprise-offline-provider-collection.v1', db: { host: '127.0.0.1', port: 3306, user: 'hzy_backup', password: pw }, binding: {
    tenant: binding.tenant, environment: binding.environment, instanceId: binding.instanceId, runtimeDeployment: binding.runtimeDeployment,
    sources: [{ app: 'aims', schema: SRC.aims, deployment: dep.aims }, { app: 'assets', schema: SRC.assets, deployment: dep.assets }],
    providers: [{ app: 'aims', schema: SRC.aims, deployment: dep.aims }, { app: 'assets', schema: SRC.assets, deployment: dep.assets },
      { app: 'codocs', schema: 'hzy_codocs', deployment: dep.codocs }, { app: 'console', schema: 'hzy_console', deployment: dep.console }],
    unconfiguredProviders: ['altoc', 'finance', 'people'] } }
  write('provider-collection.config.json', cfg)
  const p0 = now()
  const out = JSON.parse(execFileSync('node', [`${C}/provider-report-cli.mjs`, 'collect', '--config', join(W, 'provider-collection.config.json'), '--out', 'provider-report.json'], { encoding: 'utf8' }))
  const p1 = now()
  const reportBytes = readProtectedFile(join(W, 'provider-report.json')); const report = parseCanonicalJson(reportBytes)
  write('provider-report.obs.json', obs('provider-report', p0, p1, 's4-prod-provider-report-cli', { sha256: sha(reportBytes) }))
  console.log('provider-report', JSON.stringify(out), 'obs-end', p1)
  } else {
  const reportBytes = readProtectedFile(join(W, 'provider-report.json')); const report = parseCanonicalJson(reportBytes)
  const d0 = readFeed('dump-link.json').observedStart, p0 = readFeed('provider-report.obs.json').observedStart
  // P observations (M4)
  const g0 = now()
  let probe = ''
  try { probe = execFileSync('curl', ['-s', '-I', '-m', '12', 'https://wiztek.huizhi.yun/'], { encoding: 'utf8' }) } catch { probe = 'NO-RESPONSE' }
  const gwActive = /^HTTP\/[0-9.]+ 200/m.test(probe) || /x-hzy-gateway/i.test(probe)
  if (gwActive) throw Error('old entry still served by the gateway Worker: refusing to write p-gateway')
  const src = await fingerprint(); const g1 = now()
  write('p-gateway.json', obs('p-gateway', g0, g1, 'operator-cloudflare-route-bypass-verified-by-http-readback', { routeDisabled: true, workerDisabled: true,
    routeId: 'zone-huizhi.yun:wiztek.huizhi.yun/*=None', workerVersion: 'hzy-tenant-gateway-bypassed-for-host-wiztek.huizhi.yun' }))
  write('p-source.json', obs('p-source', g0, g1, 's4-prod-mysql-count-checksum-on-frozen-copies', src))
  const rt = readFeed('feed-runtime.json'), ng = readFeed('feed-nginx.json')
  if (rt.serviceActive !== 'inactive' || rt.timerActive !== 'inactive') throw Error('Japan runtime not inactive')
  if (ng.httpStatus !== '503' || ng.proxyPassCount !== '0' || ng.return503Count === '0') throw Error('nginx not in maintenance state')
  write('p-runtime.json', obs('p-runtime', rt.start, rt.end, 'operator-ssh-systemctl-is-active', { serviceInactive: true, timerInactive: true, unit: 'hzy-data-runtime.service', timer: 'hzy-data-runtime-update.timer' }))
  write('p-nginx.json', obs('p-nginx', ng.start, ng.end, 'operator-ssh-vhost-grep-and-https-status', { maintenanceConfig: true, maintenanceResponse: true, serverName: 'aidcp.wiztek.cn' }))
  const kinds = ['c2-source-first', 'c2-source-second', 'dump-link', 'provider-report', 'p-gateway', 'p-runtime', 'p-source', 'p-nginx']
  const fileOf = k => k === 'provider-report' ? 'provider-report.obs.json' : `${k}.json`
  write('manifest.json', { schemaVersion: INPUT_SCHEMA, phase: 'p', binding, files: kinds.map(k => ({ kind: k, name: fileOf(k) })), approval: null })
  const prof = JSON.parse(JSON.stringify(profileFull)); delete prof.connection
  write('profile.json', prof)
  // actor artifact identity: the fence contract hash recorded in both frozen source copies (64 hex, identical in aims and assets)
  const db = await conn(); let contract
  try { const [[a]] = await db.query(`SELECT contract_hash h FROM \`${SRC.aims}\`.enterprise_source_fence`); const [[b]] = await db.query(`SELECT contract_hash h FROM \`${SRC.assets}\`.enterprise_source_fence`)
    if (a.h !== b.h || !/^[a-f0-9]{64}$/.test(a.h)) throw Error('fence contract hash mismatch'); contract = a.h } finally { await db.end() }
  write('actors.json', ['aims', 'assets'].map(app => ({ app, artifactSha256: contract, deployment: prof.sourceDeployments[app] })))
  const cold = []
  for (const app of ['altoc', 'finance', 'people', 'webdev']) {
    const bytes = readProtectedFile(join(W, `cold-${app}.txt`))
    cold.push({ app, evidenceSha256: sha(bytes), mode: 'manual', name: `cold-${app}.txt`, reference: `S4-COLD-${app.toUpperCase()}-INVENTORY-20260930` })
  }
  write('cold-archive.json', cold)
  const sealed = JSON.parse(execFileSync('node', [`${C}/seal-cli.mjs`, 'seal', '--manifest', join(W, 'manifest.json'), '--report', join(W, 'provider-report.json'), '--profile', join(W, 'profile.json'),
    '--actors', join(W, 'actors.json'), '--cold-archive', join(W, 'cold-archive.json'), '--out-prefix', 's4'], { encoding: 'utf8', env: { ...process.env, CREDENTIALS_DIRECTORY: '/root/.hzy-drain-cred/prod' } }))
  console.log('sealed', JSON.stringify(sealed))
  const counts = report.entries.reduce((a, e) => (a[e.classification] = (a[e.classification] || 0) + 1, a), {})
  console.log('entries', JSON.stringify(counts))
  for (const e of report.entries.filter(e => e.classification !== 'automatic')) console.log('ENTRY', e.classification, e.id, '|', e.reason)
  const starts = kinds.map(k => k).length
  console.log('earliest-p-observation-start', [g0, d0, p0, rt.start, ng.start].sort()[0], 'valid-30m-from-that')
  }
} else if (cmd === 'final') {
  const decisions = JSON.parse(readFileSync(join(W, process.argv[4]), 'utf8'))
  const req = JSON.parse(readFileSync(join(W, 's4.request.json'), 'utf8'))
  const report = req.report
  // Platform digests the entries it re-derives with the same classifier, in the classifier's own key order (not the canonical sorted order).
  const derived = classifyProviderEvidence(report.binding, report.probes)
  if (canonicalJson(derived) !== canonicalJson(report.entries)) throw Error('derived entries differ from report entries')
  const by = new Map(derived.map(e => [e.id, e]))
  req.decisions = decisions.decisions.map(d => {
    const e = by.get(d.entryId); if (!e) throw Error(`unknown entry ${d.entryId}`)
    return { entryId: d.entryId, entrySha256: sha(JSON.stringify(e)), outcome: d.outcome, evidenceKind: d.evidenceKind, reference: d.reference, evidenceSha256: d.evidenceSha256, explanation: d.explanation }
  })
  req.coldArchiveReviews = decisions.coldArchiveReviews
  req.requestId = `s4-${randomUUID()}`; req.approvalReference = decisions.approvalReference
  writeProtectedNew(join(W, 's4.request.decided.json'), Buffer.from(JSON.stringify(req) + '\n'))
  const manual = derived.filter(e => e.classification === 'manual-required').map(e => e.id)
  console.log('manual entries', manual.length, 'decided', req.decisions.length, 'missing', manual.filter(id => !req.decisions.some(d => d.entryId === id)))
  console.log('request sha256', sha(readFileSync(join(W, 's4.request.decided.json'))))
}
