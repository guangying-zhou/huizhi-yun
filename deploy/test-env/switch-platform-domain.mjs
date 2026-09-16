#!/usr/bin/env node
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { X509Certificate, createHash } from 'node:crypto'
import { updateDevelopmentUrls, updateDevelopmentRouting, platformDevOrigin } from './platform-domain.mjs'

let phase = 'preflight'
process.on('uncaughtException', error => { console.error(`Domain rollout failed at ${phase} (${error.code || 'guard_failed'}); protected diagnostics suppressed.`); process.exit(1) })
const root = '/wiztek/hzy-test', backup = `${root}/backups/platform-domain-hzy-20260905`
const nginxPath = '/etc/nginx/vhost/huizhi-yun.conf', configPath = `${root}/platform-dev.config.json`
const servicePath = '/etc/systemd/system/hzy-test-platform-cert.service'
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' })
const hash = data => createHash('sha256').update(data).digest('hex')
const processes = () => JSON.parse(run('pm2', ['jlist']))
if (run('hostname', []).toString().trim() !== 'iZcqwiqyhp9u8rZ') throw new Error('Unexpected host')
const mode = process.argv[2]
if (mode === '--prepare') {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')), app = config.apps[0]
  if (app.name !== 'hzy-platform-dev' || processes().find(p => p.name === app.name)?.pm2_env.pm_cwd !== app.cwd) throw new Error('Unexpected process')
  updateDevelopmentUrls(app.env)
  updateDevelopmentRouting(fs.readFileSync(nginxPath, 'utf8'))
  fs.mkdirSync(backup, { mode: 0o700 })
  for (const [path, name] of [[configPath, 'platform-dev.config.json'], [nginxPath, 'nginx.conf'], [servicePath, 'cert.service'],
    ['/etc/letsencrypt/renewal/hzy.wiztek.cn.conf', 'renewal.conf']]) {
    fs.copyFileSync(path, `${backup}/${name}`, fs.constants.COPYFILE_EXCL); fs.chmodSync(`${backup}/${name}`, 0o600)
  }
  fs.writeFileSync(`${backup}/before.json`, JSON.stringify({ createdAt: new Date().toISOString(), nginxSha256: hash(fs.readFileSync(nginxPath)),
    configSha256: hash(fs.readFileSync(configPath)), protectedProcesses: processes().filter(p => ['hzy-platform-prod', 'hzy-console-test'].includes(p.name)).map(p => ({ name: p.name, pid: p.pid })) }), { mode: 0o600, flag: 'wx' })
  console.log('Approved virtual hosts and dev-only environment verified; protected configuration backups created.')
} else if (mode === '--execute') {
  const before = JSON.parse(fs.readFileSync(`${backup}/before.json`, 'utf8'))
  if (fs.existsSync(`${backup}/complete.json`) || hash(fs.readFileSync(nginxPath)) !== before.nginxSha256 || hash(fs.readFileSync(configPath)) !== before.configSha256) throw new Error('Already applied or config drift')
  const cert = new X509Certificate(fs.readFileSync('/etc/letsencrypt/live/hzy.wiztek.cn/fullchain.pem'))
  if (!cert.checkHost('hzy.wiztek.cn') || Date.parse(cert.validTo) < Date.now() + 30 * 86400000) throw new Error('Renew certificate before cutover')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')), app = config.apps[0]
  app.env = updateDevelopmentUrls(app.env)
  const nextNginx = updateDevelopmentRouting(fs.readFileSync(nginxPath, 'utf8'))
  try {
    phase = 'development-process'
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    run('pm2', ['restart', configPath, '--only', 'hzy-platform-dev', '--update-env'])
    let ready = false
    for (let i = 0; i < 30; i++) {
      try {
        const response = await fetch('http://127.0.0.1:3011/api/platform/auth/wecom/start', { redirect: 'manual', signal: AbortSignal.timeout(3000) })
        const url = new URL(response.headers.get('location') || 'http://invalid')
        if (response.status === 302 && url.searchParams.get('redirect_uri') === `${platformDevOrigin}/api/platform/auth/wecom/callback`) { ready = true; break }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (!ready) throw new Error('Dev OAuth readiness failed')
    phase = 'nginx-reload'
    fs.writeFileSync(nginxPath, nextNginx)
    run('nginx', ['-t']); run('nginx', ['-s', 'reload'])
    phase = 'public-routing'
    let routed = false
    // A graceful reload returns before all old workers/keepalive sockets drain.
    for (let i = 0; i < 20; i++) {
      const page = await fetch(`${platformDevOrigin}/admin/login`, { headers: { connection: 'close' }, signal: AbortSignal.timeout(10000) })
      const body = await page.text()
      const old = await fetch('https://platform-dev.wiztek.cn/admin/login', { headers: { connection: 'close' }, redirect: 'manual', signal: AbortSignal.timeout(10000) })
      if (page.ok && body.includes('平台测试控制面') && old.status === 308 && old.headers.get('location') === `${platformDevOrigin}/admin/login`) { routed = true; break }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (!routed) throw new Error('Public routing did not converge')
    phase = 'isolation-verification'
    const active = processes()
    for (const p of before.protectedProcesses) if (active.find(a => a.name === p.name)?.pid !== p.pid) throw new Error('Unrelated process changed')
    const dev = active.find(p => p.name === 'hzy-platform-dev')
    const env = Object.fromEntries(fs.readFileSync(`/proc/${dev.pid}/environ`, 'utf8').split('\0').filter(Boolean).map(v => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)]))
    if (env.DB_NAME !== 'hzy_platform_dev' || env.NUXT_DB_NAME !== 'hzy_platform_dev' || env.NUXT_PUBLIC_SERVICE_URL !== platformDevOrigin || dev.pm2_env.pm_cwd !== app.cwd) throw new Error('Active process isolation failed')
    fs.writeFileSync(servicePath, fs.readFileSync(`${root}/hzy-test-platform-cert.service`))
    run('systemctl', ['daemon-reload']); run('pm2', ['save'])
    fs.writeFileSync(`${backup}/complete.json`, JSON.stringify({ completedAt: new Date().toISOString(), origin: platformDevOrigin, database: env.DB_NAME,
      port: env.PORT, certValidTo: cert.validTo, previousDomainRedirect: 308, productionCloudflareUnmodified: true, unrelatedProcessesUnchanged: true,
      nginxSha256: hash(nextNginx), browserScanCompleted: false }, null, 2), { mode: 0o600, flag: 'wx' })
    console.log('hzy.wiztek.cn now serves development Platform; old dev domain redirects; DB/keys isolated, other processes unchanged. Real QR login still requires user scan.')
  } catch (error) {
    fs.copyFileSync(`${backup}/platform-dev.config.json`, configPath)
    fs.copyFileSync(`${backup}/nginx.conf`, nginxPath)
    fs.copyFileSync(`${backup}/cert.service`, servicePath)
    run('pm2', ['restart', configPath, '--only', 'hzy-platform-dev', '--update-env'])
    run('nginx', ['-t']); run('nginx', ['-s', 'reload']); run('systemctl', ['daemon-reload'])
    throw error
  }
} else throw new Error('Expected --prepare or --execute')
