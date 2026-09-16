#!/usr/bin/env node
// Run only through the local launcher with captured SSH stdout. Never print its output.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { parseEnv } from 'node:util'
import { validateLocalLogin } from './local-login.mjs'

try {
  if (execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw Error('Host')
  const c = JSON.parse(fs.readFileSync('/wiztek/hzy-test/runtime/config.json'))
  if (c.tenant !== 'C000001' || c.deployment !== 'c000001-test-tenant-runtime'
    || c.deploymentBindings.console !== 'wiztek-test-console' || c.deploymentBindings.people !== 'C000001-test-people'
    || c.auth.mode !== 'jwt' || c.apps.people.db.database !== 'hzy_people_test_20260905'
    || c.control.platformUrl !== 'https://hzy.wiztek.cn') throw Error('Runtime binding')
  if (process.argv[2] === '--login') {
    const l = JSON.parse(fs.readFileSync('/wiztek/hzy-test/secrets/test-login.json'))
    process.stdout.write(JSON.stringify(validateLocalLogin(l)))
  } else if (['--bootstrap', '--activation', '--workers'].includes(process.argv[2])) {
    const e = JSON.parse(execFileSync('pm2', ['jlist'], { stdio: 'pipe' })).find(p => p.name === 'hzy-platform-dev')?.pm2_env
    if (e?.DB_NAME !== 'hzy_platform_dev' || e.PLATFORM_SERVICE_URL !== c.control.platformUrl) throw Error('Control plane')
    if (process.argv[2] === '--activation') {
      const require = createRequire(`${e.pm_cwd}/.output/server/index.mjs`)
      const db = await require('mysql2/promise').createConnection({ host: e.DB_HOST, port: Number(e.DB_PORT || 3306),
        user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME })
      try {
        const [rows] = await db.query(`SELECT l.signed_token FROM licenses l
          JOIN license_deployments ld ON ld.license_id=l.id AND ld.status='active'
          JOIN deployments d ON d.id=ld.deployment_id
          WHERE d.tenant_code='C000001' AND d.environment='test' AND d.deployment_code='wiztek-test-console'
          AND d.app_code='console' AND d.status='active' AND l.status='active'`)
        if (rows.length !== 1 || !rows[0].signed_token) throw Error('License')
        const trust = JSON.parse(fs.readFileSync('/wiztek/hzy-test/runtime/platform-signing-key.json'))
        const redeemed = parseEnv(fs.readFileSync('/wiztek/hzy-test/backups/runtime-enrollment-c000001-20260905/redeemed.env', 'utf8'))
        if (!redeemed.HZY_DATA_RUNTIME_STATIC_TOKEN?.startsWith('hzy_dr_')) throw Error('Enrolled platform credential')
        process.stdout.write(JSON.stringify({ runtimeToken: redeemed.HZY_DATA_RUNTIME_STATIC_TOKEN,
          licenseToken: rows[0].signed_token, signingKid: trust.kid, signingPubkey: trust.publicKey }))
      } finally { await db.end() }
      process.exit(0)
    }
    const token = String(e.HZY_CLOUDFLARE_INTERNAL_TOKEN || e.PLATFORM_INTERNAL_SERVICE_TOKENS || e.PLATFORM_INTERNAL_SERVICE_TOKEN || '').split(',')[0].trim()
    if (!token) throw Error('Internal credential')
    const r = await fetch(`${c.control.platformUrl}/api/platform/internal/tenant-gateway/runtime-bootstrap-token`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tenantCode: 'C000001', environment: 'test', appCode: 'console' }), signal: AbortSignal.timeout(10000)
    })
    if (!r.ok) throw Error('Bootstrap')
    const { data } = await r.json()
    if (data.tenantCode !== c.tenant || data.runtimeCode !== c.deployment || data.deploymentCode !== c.deploymentBindings.console) throw Error('Response binding')
    if (process.argv[2] === '--workers') {
      const trust = JSON.parse(fs.readFileSync('/wiztek/hzy-test/runtime/platform-signing-key.json'))
      process.stdout.write(JSON.stringify({ platformToken: token, signingKid: trust.kid, signingPubkey: trust.publicKey,
        tenant: c.tenant, deployment: c.deployment, platformUrl: c.control.platformUrl, issuer: c.auth.jwt.issuer }))
    } else process.stdout.write(JSON.stringify(data))
  } else throw Error('Mode')
} catch {
  console.error('Test context unavailable; credential-bearing diagnostics suppressed.')
  process.exitCode = 1
}
