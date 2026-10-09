// Disposable-MySQL test for b13-oidc-redirect-uris.sql (+ rollback): inserts exactly ten rows, is idempotent-safe (guard), and rolls back cleanly.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../../../scripts/test/support/temporary-mysql-harness.mjs'
const here = import.meta.dirname
const schema = readFileSync(resolve(here, '../../../../console/docs/hzy_console_schema.sql'), 'utf8')
const table = name => schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS \`${name}\` \\([\\s\\S]*?\\) ENGINE=[^;]*;`))[0]
const sql = f => readFileSync(resolve(here, f), 'utf8')
const plan = await buildTemporaryMySqlPlan({ rootDir: resolve(here, '../../../..'), mysqld: process.env.MYSQLD || 'mysqld', mysql: process.env.MYSQL || 'mysql' })
await withTemporaryMySql(plan, async (context) => {
  const db = await mysql.createConnection({ ...context.connection('console'), multipleStatements: true })
  try {
    await db.query(table('auth_clients')); await db.query(table('auth_client_redirect_uris'))
    const clients = ['console', 'aims', 'workflow', 'codocs', 'insights', 'altoc']
    for (const id of clients) await db.query(`INSERT INTO auth_clients(client_id,client_name,app_code,client_type,auth_mode,source,status) VALUES(?,?,?,'public','oidc','bundle','active')`, [id, id, id])
    // Prod-shaped old rows: console at the domain root, three old domains, plus inactive/local-dev rows that must not be derived.
    const seed = async (client, uriType, uri, status = 'active') => db.query(`INSERT INTO auth_client_redirect_uris(client_id,uri_type,redirect_uri,source,status) SELECT id,?,?,'bundle',? FROM auth_clients WHERE client_id=?`, [uriType, uri, status, client])
    const oldPaths = { console: '', aims: 'aims/', workflow: 'workflow/' }
    for (const [client, path] of Object.entries(oldPaths)) for (const host of ['wiztek.huizhi.yun', 'console.huizhi.yun', 'wiztekdev.huizhi.yun']) {
      await seed(client, 'redirect', `https://${host}/${path}api/auth/oidc-callback`); await seed(client, 'post_logout', `https://${host}/${path}api/auth/oidc-post-logout`)
    }
    await seed('console', 'redirect', 'https://wiztek.huizhi.yun/api/auth/wecom-old', 'inactive')
    await seed('codocs', 'post_logout', 'https://console.huizhi.yun/codocs/api/auth/oidc-post-logout')
    const total = (await db.query('SELECT COUNT(*) n FROM auth_client_redirect_uris'))[0][0].n
    const count = async () => (await db.query(`SELECT COUNT(*) n FROM auth_client_redirect_uris WHERE redirect_uri LIKE 'https://aidcp.wiztek.cn/%'`))[0][0].n
    const run = async (file, apply) => { const r = await db.query(`SET @apply=${apply}; ${sql(file)}`); return r[0] }
    // Plan mode never writes. Enterprise client missing (G-7 not applied yet): guards fail, apply inserts nothing.
    await run('b13-oidc-redirect-uris.sql', 0); assert.equal(await count(), 0, 'plan mode writes nothing')
    await run('b13-oidc-redirect-uris.sql', 1); assert.equal(await count(), 0, 'guard: enterprise client must exist first')
    await db.query(`INSERT INTO auth_clients(client_id,client_name,app_code,client_type,auth_mode,source,status) VALUES('enterprise','enterprise','enterprise','public','oidc','local','active')`)
    const out = await db.query(`SET @apply=0; ${sql('b13-oidc-redirect-uris.sql')}`)
    const sets = out[0].filter(Array.isArray)
    const plan = sets.find(r => r.length && 'new_uri' in r[0]); const guards = sets.find(r => r.length && 'guards_ok' in r[0])[0]
    if (process.env.PRINT_PLAN) for (const r of plan) console.log(`${r.client_id}\t${r.uri_type}\t${r.old_uri ?? '(none)'}\t->\t${r.new_uri}\t[${r.basis}]`)
    assert.equal(plan.length, 10); assert.equal(Number(guards.guards_ok), 1); assert.equal(Number(guards.derived_rows), 6)
    const byKey = Object.fromEntries(plan.map(r => [`${r.client_id}/${r.uri_type}`, r]))
    assert.equal(byKey['console/redirect'].old_uri, 'https://wiztek.huizhi.yun/api/auth/oidc-callback')
    assert.equal(byKey['console/redirect'].new_uri, 'https://aidcp.wiztek.cn/console/api/auth/oidc-callback')
    assert.equal(byKey['console/post_logout'].new_uri, 'https://aidcp.wiztek.cn/console/api/auth/oidc-post-logout')
    assert.equal(byKey['aims/redirect'].new_uri, 'https://aidcp.wiztek.cn/aims/api/auth/oidc-callback')
    assert.equal(byKey['workflow/post_logout'].new_uri, 'https://aidcp.wiztek.cn/workflow/api/auth/oidc-post-logout')
    assert.equal(byKey['codocs/redirect'].basis, 'explicit'); assert.equal(byKey['enterprise/post_logout'].new_uri, 'https://aidcp.wiztek.cn/enterprise/login')
    assert.equal(await count(), 0, 'plan mode still writes nothing')
    await run('b13-oidc-redirect-uris.sql', 1); assert.equal(await count(), 10)
    const [rows] = await db.query(`SELECT c.client_id, u.uri_type, u.source, u.status FROM auth_client_redirect_uris u JOIN auth_clients c ON c.id=u.client_id WHERE u.redirect_uri LIKE 'https://aidcp.wiztek.cn/%' ORDER BY 1,2`)
    assert.ok(rows.every(r => r.source === 'local' && r.status === 'active'))
    assert.deepEqual([...new Set(rows.map(r => r.client_id))].sort(), ['aims', 'codocs', 'console', 'enterprise', 'workflow'])
    await run('b13-oidc-redirect-uris.sql', 1); assert.equal(await count(), 10, 'second run: guard prevents duplicates')
    await db.query(sql('b13-oidc-redirect-uris.rollback.sql')); assert.equal(await count(), 0)
    const [[kept]] = await db.query(`SELECT COUNT(*) n FROM auth_client_redirect_uris`); assert.equal(kept.n, total, 'rollback removes only its ten rows')
    // Drift: an extra active old-domain row changes the derived count, so apply inserts nothing.
    await seed('aims', 'redirect', 'https://wiztek.huizhi.yun/aims/api/auth/extra'); await run('b13-oidc-redirect-uris.sql', 1); assert.equal(await count(), 0, 'guard: derived count drift')
    console.log('b13 oidc redirect URIs test: OK (plan read-only, derived+explicit ten rows, console /console prefix, guards, second run no-op, rollback exact)')
  } finally { await db.end() }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
