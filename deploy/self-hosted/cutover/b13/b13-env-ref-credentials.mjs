#!/usr/bin/env node
// S4 B13: initial env_ref credential for enterprise.runtime (after the G-7 apply, before the Runtime starts with the final config).
// The three existing env_ref clients (aims/codocs/workflow) are NOT touched: their old secret values are carried over unchanged, so
// their content hashes keep matching.
//   --plan      read-only: shows the current state (no secrets, hashes truncated)
//   --apply     one transaction: create the enterprise.runtime credential chain; verifies, then commits
//   --rollback  removes the enterprise.runtime rows (verifies the three existing rows are byte-for-byte what --apply saw)
// Optional --align-existing (only when the old secret values could not be carried over): also aligns the three existing rows'
// content hash to the canonical env_ref form (b13-env-ref-content-hash-align.sql); --rollback then restores the pre-image hashes.
// Usage: node b13-env-ref-credentials.mjs --config <db.json> --pre-image <file> [--align-existing] (--plan | --apply | --rollback)
// db.json: {"host","port","user","password","database"} (0600). The pre-image file (0600) holds only hashes and previews of the three untouched rows, used to prove they did not change.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const here = dirname(fileURLToPath(import.meta.url))
const sql = name => readFileSync(join(here, name), 'utf8')
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const sha = text => createHash('sha256').update(text).digest('hex')
const canonical = ref => `sha256_${sha(ref)}`
const EXISTING = {
  'svc.aims.runtime.client_secret': 'HZY_SERVICE_CLIENT_AIMS_SECRET',
  'svc.codocs.runtime.client_secret': 'HZY_SERVICE_CLIENT_CODOCS_SECRET',
  'svc.workflow.runtime.client_secret': 'HZY_SERVICE_CLIENT_WORKFLOW_SECRET'
}
const ENTERPRISE = { code: 'svc.enterprise.runtime.client_secret', ref: 'HZY_SERVICE_CLIENT_ENTERPRISE_SECRET' }

async function existingState(db) {
  const [rows] = await db.query(`SELECT s.id AS secret_id, s.secret_code, s.masked_preview, s.storage_backend, s.status AS secret_status,
      v.id AS version_id, v.backend_secret_ref, v.content_hash, v.encryption_scheme, v.status AS version_status
    FROM vault_secrets s JOIN vault_secret_versions v ON v.id = s.current_version_id AND v.secret_id = s.id
    WHERE s.secret_code IN (?)`, [Object.keys(EXISTING)])
  return rows
}
async function enterpriseState(db) {
  const [clients] = await db.query(`SELECT id, status, app_code, current_credential_id FROM service_clients WHERE client_code='enterprise.runtime'`)
  const client = clients[0]
  const [[counts]] = await db.query(`SELECT
      (SELECT COUNT(*) FROM vault_secrets WHERE secret_code=?) AS secrets,
      (SELECT COUNT(*) FROM service_client_credentials WHERE client_id='enterprise.runtime') AS credentials`, [ENTERPRISE.code])
  return { client, ...counts }
}
async function chainRow(db, clientId) {
  // Same join as ConsumeServiceClientCredential (auth_service_tokens.go).
  const [rows] = await db.query(`SELECT sc.client_code, vs.storage_backend, vsv.backend_secret_ref, vsv.content_hash, vsv.encryption_scheme
    FROM service_client_credentials scc
    INNER JOIN service_clients sc ON sc.id=scc.service_client_id AND sc.current_credential_id=scc.id AND sc.status='active'
    INNER JOIN vault_secrets vs ON vs.id=scc.secret_id AND vs.status='active'
    INNER JOIN vault_secret_versions vsv ON vsv.id=vs.current_version_id AND vsv.secret_id=vs.id AND vsv.status='active'
    WHERE scc.client_id=? AND scc.status='active' AND (scc.expires_at IS NULL OR scc.expires_at>UTC_TIMESTAMP()) LIMIT 1`, [clientId])
  return rows[0]
}
// Mirrors vaultContentHashMatches: value hash OR backend-ref-name hash OR empty.
const acceptsAnyValue = row => row && row.storage_backend === 'env_ref' && row.encryption_scheme === 'external_ref' && row.content_hash === canonical(row.backend_secret_ref)

async function main() {
  const configPath = value('--config')
  const prePath = value('--pre-image')
  const mode = ['--plan', '--apply', '--rollback'].find(flag)
  if (!configPath || !prePath || !mode) throw new Error('usage: --config <db.json> --pre-image <file> (--plan|--apply|--rollback)')
  const cfg = JSON.parse(readFileSync(configPath, 'utf8'))
  const db = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, multipleStatements: true, dateStrings: true })
  try {
    const existing = await existingState(db)
    const ent = await enterpriseState(db)
    if (mode === '--plan') {
      console.log(JSON.stringify({ mode: 'plan', existing: existing.map(r => ({ code: r.secret_code, ref: r.backend_secret_ref, hashNow: r.content_hash.slice(0, 16), aligned: r.content_hash === canonical(r.backend_secret_ref), backend: r.storage_backend })), enterprise: { clientFound: Boolean(ent.client), clientStatus: ent.client?.status, hasCredential: Boolean(ent.client?.current_credential_id), secretRows: ent.secrets, credentialRows: ent.credentials } }, null, 1))
      return
    }
    if (mode === '--apply') {
      if (existsSync(prePath)) throw new Error('pre-image file already exists; refusing to overwrite')
      if (existing.length !== 3) throw new Error(`expected 3 existing env_ref secrets, found ${existing.length}`)
      for (const r of existing) {
        if (r.storage_backend !== 'env_ref' || r.secret_status !== 'active' || r.version_status !== 'active' || r.encryption_scheme !== 'external_ref' || r.backend_secret_ref !== EXISTING[r.secret_code]) throw new Error(`unexpected shape for ${r.secret_code}`)
      }
      if (!ent.client || ent.client.status !== 'active' || ent.client.app_code !== 'enterprise' || ent.client.current_credential_id || ent.secrets || ent.credentials) throw new Error('enterprise.runtime is not in the expected pre-state (run the G-7 apply first; no credential may exist)')
      writeFileSync(prePath, JSON.stringify({ takenAt: new Date().toISOString(), rows: existing.map(r => ({ secret_id: r.secret_id, version_id: r.version_id, secret_code: r.secret_code, content_hash: r.content_hash, masked_preview: r.masked_preview })) }, null, 1), { mode: 0o600 })
      await db.beginTransaction()
      try {
        await db.query(sql('b13-enterprise-runtime-env-ref-credential.sql'))
        if (flag('--align-existing')) await db.query(sql('b13-env-ref-content-hash-align.sql'))
        const after = await existingState(db)
        const pre0 = JSON.parse(readFileSync(prePath, 'utf8'))
        if (flag('--align-existing')) {
          if (after.length !== 3 || !after.every(r => r.content_hash === canonical(r.backend_secret_ref) && r.masked_preview === 'env-ref')) throw new Error('alignment verification failed')
        } else if (after.length !== 3 || !pre0.rows.every(r => { const n = after.find(x => x.secret_code === r.secret_code); return n && n.content_hash === r.content_hash && n.masked_preview === r.masked_preview })) throw new Error('existing env_ref rows changed unexpectedly')
        const chain = await chainRow(db, 'enterprise.runtime')
        if (!acceptsAnyValue(chain)) throw new Error('enterprise.runtime credential chain verification failed')
        for (const code of ['aims.runtime', 'codocs.runtime', 'workflow.runtime']) { const row = await chainRow(db, code); if (!row || (flag('--align-existing') && !acceptsAnyValue(row))) throw new Error(`${code} credential chain is broken`) }
        const [[c]] = await db.query(`SELECT (SELECT COUNT(*) FROM vault_secrets WHERE secret_code=?) s, (SELECT COUNT(*) FROM vault_secret_versions WHERE secret_id=(SELECT id FROM vault_secrets WHERE secret_code=?)) v, (SELECT COUNT(*) FROM service_client_credentials WHERE client_id='enterprise.runtime') c`, [ENTERPRISE.code, ENTERPRISE.code])
        if (c.s !== 1 || c.v !== 1 || c.c !== 1) throw new Error('enterprise.runtime row counts wrong')
        await db.commit()
        console.log('B13 APPLIED: enterprise.runtime credential created; 3 existing rows unchanged; chains present for 4 clients')
      } catch (error) {
        await db.rollback()
        throw error
      }
      return
    }
    // --rollback
    const pre = JSON.parse(readFileSync(prePath, 'utf8'))
    await db.beginTransaction()
    try {
      await db.query(sql('b13-enterprise-runtime-env-ref-credential.rollback.sql'))
      if (flag('--align-existing')) {
        for (const r of pre.rows) {
          const [res] = await db.query(`UPDATE vault_secret_versions v JOIN vault_secrets s ON s.id=v.secret_id AND s.current_version_id=v.id
            SET v.content_hash=?, s.masked_preview=?, s.updated_at=UTC_TIMESTAMP() WHERE s.id=? AND v.id=? AND s.secret_code=?`, [r.content_hash, r.masked_preview, r.secret_id, r.version_id, r.secret_code])
          if (res.affectedRows < 1) throw new Error(`rollback could not restore ${r.secret_code}`)
        }
      }
      const ent2 = await enterpriseState(db)
      if (ent2.secrets || ent2.credentials || ent2.client?.current_credential_id) throw new Error('enterprise.runtime rows remain after rollback')
      const back = await existingState(db)
      for (const r of pre.rows) { const now = back.find(x => x.secret_code === r.secret_code); if (!now || now.content_hash !== r.content_hash || now.masked_preview !== r.masked_preview) throw new Error(`pre-image mismatch for ${r.secret_code}`) }
      await db.commit()
      console.log('B13 ROLLED BACK: enterprise.runtime rows removed; 3 existing rows equal the pre-image')
    } catch (error) {
      await db.rollback()
      throw error
    }
  } finally {
    await db.end()
  }
}
main().catch((error) => { console.error('B13_FAILED:', error.message); process.exit(1) })
