// Test control-plane routing only. Run on the explicitly approved domestic host.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
try {
  if (execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ'
    || process.argv[2] !== '--execute') throw Error('Host or mode')
  const e = JSON.parse(execFileSync('pm2', ['jlist'], { stdio: 'pipe' })).find(p => p.name === 'hzy-platform-dev')?.pm2_env
  if (e?.DB_NAME !== 'hzy_platform_dev' || e.PLATFORM_SERVICE_URL !== 'https://hzy.wiztek.cn') throw Error('Control plane')
  const require = createRequire(`${e.pm_cwd}/.output/server/index.mjs`)
  const db = await require('mysql2/promise').createConnection({ host: e.DB_HOST, port: Number(e.DB_PORT || 3306), user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME })
  try {
    const [sites] = await db.query("SELECT id FROM deployment_sites WHERE tenant_code='C000001' AND environment='test' AND status='active' AND public_url='https://hzy-test.huizhi.yun'")
    if (sites.length !== 1) throw Error('Test site')
    await db.beginTransaction()
    for (const app of ['aims','assets','finance']) {
      const [subscriptions] = await db.query("SELECT id FROM subscriptions WHERE tenant_code='C000001' AND app_code=? AND status='active'",[app])
      if (subscriptions.length !== 1) throw Error('Subscription')
      const code=`C000001-test-${app}`
      const [existing] = await db.query("SELECT deployment_code FROM deployments WHERE tenant_code='C000001' AND app_code=? AND environment='test' AND status='active'",[app])
      if (existing.length) { if(existing.length!==1 || existing[0].deployment_code!==code) throw Error('Test deployment conflict'); continue }
      await db.execute(`INSERT INTO deployments
        (tenant_code,app_code,subscription_id,deployment_code,deployment_name,deployment_mode,environment,status,license_status,connectivity_status,site_id,base_path,api_base,route_source,runtime_endpoint)
        VALUES ('C000001',?,?,?,?,'managed-control-plane','test','active','pending','passed',?,?,?,'override','https://hzy.wiztek.cn')`,
        [app,subscriptions[0].id,code,`C000001 ${app} product center test`,sites[0].id,`/${app}`,`/${app}/api`])
    }
    await db.commit()
    const [rows] = await db.query("SELECT app_code,deployment_code,license_status FROM deployments WHERE tenant_code='C000001' AND environment='test' AND status='active' ORDER BY app_code")
    console.log(JSON.stringify(rows))
  } finally { await db.end() }
} catch { console.error('Test deployment registration failed; diagnostics suppressed'); process.exitCode=1 }
