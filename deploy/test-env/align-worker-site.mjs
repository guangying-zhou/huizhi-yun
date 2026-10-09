// Test control-plane routing only. Run on the explicitly approved domestic host.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
try {
  if (execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ'
    || !['--check', '--execute'].includes(process.argv[2])) throw Error('Host or mode')
  const e = JSON.parse(execFileSync('pm2', ['jlist'], { stdio: 'pipe' })).find(p => p.name === 'hzy-platform-dev')?.pm2_env
  if (e?.DB_NAME !== 'hzy_platform_dev' || e.PLATFORM_SERVICE_URL !== 'https://hzy.wiztek.cn') throw Error('Control plane')
  const require = createRequire(`${e.pm_cwd}/.output/server/index.mjs`)
  const db = await require('mysql2/promise').createConnection({ host: e.DB_HOST, port: Number(e.DB_PORT || 3306), user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME })
  try {
    await db.beginTransaction()
    const [sites] = await db.query("SELECT id,site_code,public_url FROM deployment_sites WHERE tenant_code='C000001' AND environment='test' AND status='active' FOR UPDATE")
    const [apps] = await db.query("SELECT app_code,deployment_code,site_id FROM deployments WHERE tenant_code='C000001' AND environment='test' AND status='active' ORDER BY app_code FOR UPDATE")
    const origin = 'https://hzy0.isme.dev'
    if (sites.length !== 1 || sites[0].site_code !== 'wiztek-test'
      || !['https://hzy-test.wiztek.cn', origin].includes(sites[0].public_url)
      || apps.length !== 2 || apps[0].deployment_code !== 'wiztek-test-console' || apps[1].deployment_code !== 'C000001-test-people'
      || apps.some(a => a.site_id !== sites[0].id)) throw Error('Test deployment binding')
    if (process.argv[2] === '--check') {
      await db.rollback()
      console.log(JSON.stringify({ site: sites[0], apps, target: origin }))
    } else {
      const backup = `/wiztek/hzy-test/backups/worker-site-${Date.now()}`
      fs.mkdirSync(backup, { mode: 0o700 })
      fs.writeFileSync(`${backup}/before.json`, JSON.stringify({ sites, apps }), { mode: 0o600 })
      await db.execute("UPDATE deployment_sites SET public_url=?,updated_at=UTC_TIMESTAMP() WHERE id=? AND tenant_code='C000001' AND environment='test' AND status='active'", [origin, sites[0].id])
      await db.commit()
      const token = String(e.HZY_CLOUDFLARE_INTERNAL_TOKEN || e.PLATFORM_INTERNAL_SERVICE_TOKENS || e.PLATFORM_INTERNAL_SERVICE_TOKEN || '').split(',')[0].trim()
      if (!token) throw Error('Internal credential')
      const r = await fetch('https://hzy.wiztek.cn/api/platform/internal/tenants/C000001/bundles', {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ environment: 'test', platformBaseUrl: 'https://hzy.wiztek.cn' }), signal: AbortSignal.timeout(60000)
      })
      if (!r.ok) throw Error('Test bundle publication')
      const { data } = await r.json()
      console.log(JSON.stringify({ backup, site: origin, bundleVersion: data.bundleVersion, environment: data.environment }))
    }
  } finally { await db.end() }
} catch {
  console.error('Test site alignment failed; inspect protected backup and test bundle state. Secret diagnostics suppressed.')
  process.exitCode = 1
}
