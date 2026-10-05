// Disposable-MySQL test for b13-env-ref-credentials.mjs (plan/apply/rollback + refusal cases). Run: node test-b13-env-ref-credentials-mysql.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../../../scripts/test/support/temporary-mysql-harness.mjs'

const here = import.meta.dirname
const schema = readFileSync(resolve(here, '../../../../console/docs/hzy_console_schema.sql'), 'utf8')
const table = name => schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS \`${name}\` \\([\\s\\S]*?\\) ENGINE=[^;]*;`))[0]
const sha = t => createHash('sha256').update(t).digest('hex')
const run = (cfg, pre, mode, ...extra) => {
  try { return { ok: true, out: execFileSync('node', [join(here, 'b13-env-ref-credentials.mjs'), '--config', cfg, '--pre-image', pre, ...extra, mode], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } }
  catch (error) { return { ok: false, out: `${error.stdout}${error.stderr}` } }
}
const plan = await buildTemporaryMySqlPlan({ rootDir: resolve(here, '../../../..'), mysqld: process.env.MYSQLD || 'mysqld', mysql: process.env.MYSQL || 'mysql' })
await withTemporaryMySql(plan, async (context) => {
  const conn = context.connection('console')
  const db = await mysql.createConnection({ ...conn, multipleStatements: true, dateStrings: true })
  const dir = mkdtempSync(join(tmpdir(), 'b13-'))
  try {
    for (const t of ['service_clients', 'vault_secrets', 'vault_secret_versions', 'service_client_credentials', 'vault_access_logs']) await db.query(table(t))
    const cfg = join(dir, 'db.json')
    writeFileSync(cfg, JSON.stringify({ host: conn.host, port: conn.port, user: conn.user, password: conn.password, database: conn.database }), { mode: 0o600 })
    // Seed: the shape of production (env_ref, content_hash = sha256(OLD VALUE)), plus an enterprise.runtime client created by G-7 without a credential.
    const seed = [['aims.runtime', 'aims', 'HZY_SERVICE_CLIENT_AIMS_SECRET'], ['codocs.runtime', 'codocs', 'HZY_SERVICE_CLIENT_CODOCS_SECRET'], ['workflow.runtime', 'workflow', 'HZY_SERVICE_CLIENT_WORKFLOW_SECRET']]
    for (const [code, app, ref] of seed) {
      const [c] = await db.query(`INSERT INTO service_clients(client_code,client_name,client_type,app_code,status) VALUES(?,?,'app',?,'active')`, [code, code, app])
      const [s] = await db.query(`INSERT INTO vault_secrets(secret_code,secret_ref,secret_name,secret_type,usage_type,owner_type,owner_key,storage_backend,reveal_policy,masked_preview,status,created_by) VALUES(?,?,?,'client_secret','service','service_client',?,'env_ref','approval','ab12****cd34','active','system')`, [`svc.${code}.client_secret`, `hzybase://vault/svc.${code}.client_secret`, code, code])
      const [v] = await db.query(`INSERT INTO vault_secret_versions(secret_id,version_no,backend_secret_ref,content_hash,encryption_scheme,status,created_by) VALUES(?,1,?,?,'external_ref','active','system')`, [s.insertId, ref, `sha256_${sha(`old-value-of-${code}`)}`])
      await db.query('UPDATE vault_secrets SET current_version_id=? WHERE id=?', [v.insertId, s.insertId])
      const [cr] = await db.query(`INSERT INTO service_client_credentials(service_client_id,client_id,version_no,secret_id,status) VALUES(?,?,1,?,'active')`, [c.insertId, code, s.insertId])
      await db.query('UPDATE service_clients SET current_credential_id=? WHERE id=?', [cr.insertId, c.insertId])
    }
    await db.query(`INSERT INTO service_clients(client_code,client_name,client_type,app_code,status) VALUES('enterprise.runtime','Enterprise','app','enterprise','active')`)
    const snapshot = async () => JSON.stringify(await Promise.all(['service_clients', 'vault_secrets', 'vault_secret_versions', 'service_client_credentials', 'vault_access_logs'].map(async t => (await db.query(`SELECT * FROM ${t} ORDER BY id`))[0].map(r => ({ ...r, updated_at: undefined })))))
    const before = await snapshot()
    const pre = join(dir, 'pre.json')

    let r = run(cfg, pre, '--plan'); assert.ok(r.ok, r.out); assert.match(r.out, /"clientFound": true/)
    assert.equal(await snapshot(), before, 'plan must not write')

    r = run(cfg, pre, '--apply'); assert.ok(r.ok, r.out); assert.match(r.out, /B13 APPLIED/)
    const [[chain]] = await db.query(`SELECT vs.storage_backend, vsv.backend_secret_ref, vsv.content_hash, vsv.encryption_scheme, scc.client_id, scc.status FROM service_client_credentials scc
      JOIN service_clients sc ON sc.id=scc.service_client_id AND sc.current_credential_id=scc.id JOIN vault_secrets vs ON vs.id=scc.secret_id AND vs.current_version_id IS NOT NULL
      JOIN vault_secret_versions vsv ON vsv.id=vs.current_version_id WHERE scc.client_id='enterprise.runtime'`)
    assert.equal(chain.storage_backend, 'env_ref'); assert.equal(chain.backend_secret_ref, 'HZY_SERVICE_CLIENT_ENTERPRISE_SECRET')
    assert.equal(chain.content_hash, `sha256_${sha('HZY_SERVICE_CLIENT_ENTERPRISE_SECRET')}`); assert.equal(chain.encryption_scheme, 'external_ref'); assert.equal(chain.status, 'active')
    const [[same]] = await db.query(`SELECT COUNT(*) n FROM vault_secret_versions WHERE content_hash=?`, [`sha256_${sha('old-value-of-aims.runtime')}`]); assert.equal(same.n, 1, 'existing rows untouched')

    r = run(cfg, join(dir, 'pre2.json'), '--apply'); assert.equal(r.ok, false); assert.match(r.out, /not in the expected pre-state/, 'second apply must refuse')
    assert.equal(existsSync(join(dir, 'pre2.json')), false)

    r = run(cfg, pre, '--rollback'); assert.ok(r.ok, r.out); assert.match(r.out, /ROLLED BACK/)
    const after = await snapshot()
    const strip = s => JSON.parse(s).map(t => t.map(row => { const { current_credential_id, ...rest } = row; return rest }))
    // The auto-increment counters differ, but the rows must be exactly the seeded ones again.
    assert.deepEqual(strip(after).map(t => t.length), strip(before).map(t => t.length))
    assert.deepEqual(strip(after)[1], strip(before)[1]); assert.deepEqual(strip(after)[2], strip(before)[2])
    const [[e]] = await db.query(`SELECT current_credential_id FROM service_clients WHERE client_code='enterprise.runtime'`); assert.equal(e.current_credential_id, null)

    // Alternative path (--align-existing): old values not carried over, hashes aligned to the canonical env_ref form; rollback restores them.
    rmSync(pre, { force: true }); r = run(cfg, pre, '--apply', '--align-existing'); assert.ok(r.ok, r.out)
    const [aligned] = await db.query(`SELECT backend_secret_ref, content_hash FROM vault_secret_versions WHERE backend_secret_ref IN ('HZY_SERVICE_CLIENT_AIMS_SECRET','HZY_SERVICE_CLIENT_CODOCS_SECRET','HZY_SERVICE_CLIENT_WORKFLOW_SECRET')`)
    assert.equal(aligned.length, 3); for (const a of aligned) assert.equal(a.content_hash, `sha256_${sha(a.backend_secret_ref)}`)
    r = run(cfg, pre, '--rollback', '--align-existing'); assert.ok(r.ok, r.out)
    const [[restored]] = await db.query(`SELECT content_hash, (SELECT masked_preview FROM vault_secrets WHERE id=secret_id) mp FROM vault_secret_versions WHERE backend_secret_ref='HZY_SERVICE_CLIENT_AIMS_SECRET'`)
    assert.equal(restored.content_hash, `sha256_${sha('old-value-of-aims.runtime')}`); assert.equal(restored.mp, 'ab12****cd34')

    // Refusals: existing row with a different variable name, and a missing G-7 client.
    await db.query(`UPDATE vault_secret_versions SET backend_secret_ref='SOMETHING_ELSE' WHERE backend_secret_ref='HZY_SERVICE_CLIENT_CODOCS_SECRET'`)
    rmSync(pre, { force: true }); r = run(cfg, pre, '--apply'); assert.equal(r.ok, false); assert.match(r.out, /unexpected shape/)
    await db.query(`UPDATE vault_secret_versions SET backend_secret_ref='HZY_SERVICE_CLIENT_CODOCS_SECRET' WHERE backend_secret_ref='SOMETHING_ELSE'`)
    await db.query(`UPDATE service_clients SET status='inactive' WHERE client_code='enterprise.runtime'`)
    rmSync(pre, { force: true }); r = run(cfg, pre, '--apply'); assert.equal(r.ok, false); assert.match(r.out, /not in the expected pre-state/)
    console.log('b13 env_ref credential test: OK (plan read-only, apply, second-apply refusal, rollback, shape/pre-state refusals)')
  } finally {
    await db.end()
    rmSync(dir, { recursive: true, force: true })
  }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
