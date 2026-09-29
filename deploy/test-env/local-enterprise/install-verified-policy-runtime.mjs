// One-off, pinned local Runtime deployment. Not part of the hzy0 process manager.
// Default is read-only; --apply installs only this schema/grant/binary/config.
import { readFileSync, writeFileSync, statSync, mkdirSync, copyFileSync, chmodSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateReadinessTarget } from './verified-policy-readiness.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const directory = '/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime'
const candidate = '/var/folders/hj/z589ry191rj30w79jr0m6f8w0000gn/T/hzy-verified-policy-runtime-eLWkgz/hzy-data-runtime'
const previousHash = 'dd054a05c5335035f8a488b68fdab93bd3b016c80f2de68e05731d8454fb50a0'
const candidateHash = '426b747bea29d29729e8b73d81d5f1ffb6494e1b99d99a5b9e1241ee1cb197ec'
const version = '0.3.219-test.verified-policy.1'
const configPath = `${directory}/config.json`
const binary = `${directory}/hzy-data-runtime`
const backup = `${directory}/deployments/verified-policy-20260921`
const label = `gui/${process.getuid()}/cn.wiztek.hzy-test-runtime`
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
function protectedJson(path) {
  const stat = statSync(path)
  if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw Error('unsafe_file')
  return JSON.parse(readFileSync(path, 'utf8'))
}
function restart() {
  if (spawnSync('launchctl', ['kickstart', '-k', label], { stdio: 'ignore' }).status !== 0) throw Error('runtime_restart_failed')
}
async function health(expected) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await fetch('http://127.0.0.1:18084/runtime/healthz', { redirect: 'error', signal: AbortSignal.timeout(2000) }).then(r => r.json()).catch(() => null)
    if (result?.status === 'ok' && result.version === expected && result.tenant === 'C000001' && result.deployment === 'c000001-test-tenant-runtime') return result
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw Error('runtime_health_failed')
}
async function main() {
  if (process.argv.length > 3 || ![undefined, '--apply'].includes(process.argv[2])) throw Error('invalid_arguments')
  const config = protectedJson(configPath)
  const profile = protectedJson('/Users/gavinzhou/.config/huizhi-yun/hzy0/profile.json')
  validateReadinessTarget(profile, config)
  if (digest(binary) !== previousHash || digest(candidate) !== candidateHash) throw Error('artifact_mismatch')
  const launch = spawnSync('plutil', ['-convert', 'json', '-o', '-', '/Users/gavinzhou/Library/LaunchAgents/cn.wiztek.hzy-test-runtime.plist'], { encoding: 'utf8' })
  if (launch.status !== 0) throw Error('launchagent_unavailable')
  const agent = JSON.parse(launch.stdout)
  if (agent.Label !== 'cn.wiztek.hzy-test-runtime' || JSON.stringify(agent.ProgramArguments) !== JSON.stringify([binary])
    || agent.WorkingDirectory !== directory || agent.EnvironmentVariables.HZY_DATA_RUNTIME_CONFIG !== configPath) throw Error('launchagent_mismatch')
  await health('0.3.219-test.product-edit-audit.1')
  const require = createRequire(new URL('../../../platform/package.json', import.meta.url))
  const { host, port, user, password, database } = config.apps.console.db
  const db = await require('mysql2/promise').createConnection({ host, port, user, password, database, multipleStatements: false })
  let replaced = false
  const receipt = { observedAt: new Date().toISOString(), version, candidateHash, previousHash, backup,
    tenant: config.tenant, deployment: config.deployment, applied: false, enterpriseWriteGranted: false, acceptancePassed: false }
  try {
    const [clients] = await db.query("SELECT c.id FROM service_clients c JOIN service_client_credentials k ON k.id=c.current_credential_id AND k.service_client_id=c.id WHERE c.client_code='enterprise.runtime' AND c.app_code='enterprise' AND c.status='active' AND k.status='active'")
    if (clients.length !== 1) throw Error('enterprise_identity_unavailable')
    const [grants] = await db.query("SELECT id,action,status FROM service_client_grants WHERE service_client_id=? AND resource_code='console:policy-bundle'", [clients[0].id])
    if (grants.some(row => row.action !== 'read' || row.status !== 'active') || grants.length > 1) throw Error('grant_precondition_failed')
    if (process.argv[2] !== '--apply') { console.log(JSON.stringify({ ...receipt, readyToInstall: true })); return }
    mkdirSync(backup, { mode: 0o700 }) // Refuse accidental replay/overwrite of rollback material.
    for (const [from, name] of [[configPath, 'config.before.json'], [binary, 'hzy-data-runtime.before']]) {
      copyFileSync(from, `${backup}/${name}`); chmodSync(`${backup}/${name}`, name.endsWith('.json') ? 0o600 : 0o700)
    }
    for (const sql of ['Console-SQL-Migration-verified-policy-snapshots.sql', 'Console-SQL-Seed-enterprise-policy-reader.sql']) {
      await db.query(readFileSync(`${root}/console/docs/sql/${sql}`, 'utf8'))
    }
    const [installed] = await db.query("SELECT id,action,status FROM service_client_grants WHERE service_client_id=? AND resource_code='console:policy-bundle'", [clients[0].id])
    if (installed.length !== 1 || installed[0].action !== 'read' || installed[0].status !== 'active') throw Error('grant_verification_failed')
    receipt.enterpriseReadGrantId = installed[0].id
    receipt.enterpriseReadGrantAdded = grants.length === 0
    config.apps.console.policyEnvelope = { enabled: true, enterpriseReadEnabled: true, environment: 'test', maxAgeMs: 300000 }
    writeFileSync(`${backup}/config.after.json`, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    copyFileSync(candidate, `${directory}/hzy-data-runtime.policy-new`); chmodSync(`${directory}/hzy-data-runtime.policy-new`, 0o700)
    copyFileSync(`${backup}/config.after.json`, `${directory}/config.policy-new.json`); chmodSync(`${directory}/config.policy-new.json`, 0o600)
    replaced = true
    renameSync(`${directory}/config.policy-new.json`, configPath)
    renameSync(`${directory}/hzy-data-runtime.policy-new`, binary)
    restart()
    const active = await health(version)
    receipt.applied = true; receipt.runtimeCommit = active.commit
    for (const path of ['/v1/console/verified-policy', '/v1/enterprise/console-policy']) {
      const response = await fetch(`http://127.0.0.1:18084${path}`, { redirect: 'error', signal: AbortSignal.timeout(5000) })
      await response.body?.cancel()
      if (response.status !== 401) throw Error('anonymous_guard_failed')
    }
    receipt.anonymousGuardsVerified = true
    writeFileSync(`${root}/deploy/test-env/artifacts/C000001.local-verified-policy-runtime.json`, JSON.stringify(receipt, null, 2) + '\n')
    console.log(JSON.stringify(receipt, null, 2))
  } catch (error) {
    if (replaced) {
      copyFileSync(`${backup}/config.before.json`, configPath)
      copyFileSync(`${backup}/hzy-data-runtime.before`, `${directory}/hzy-data-runtime.policy-rollback`)
      renameSync(`${directory}/hzy-data-runtime.policy-rollback`, binary)
      restart(); await health('0.3.219-test.product-edit-audit.1')
    }
    // Schema and authentic watermark are never dropped on binary rollback.
    throw error
  } finally { await db.end() }
}
main().catch(() => { console.error('Pinned Runtime installation failed; sensitive details suppressed. Inspect target health and protected rollback material.'); process.exitCode = 1 })
