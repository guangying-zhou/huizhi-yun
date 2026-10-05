#!/usr/bin/env node
// Reuse the existing corporate identity provider; preserve separate development sessions/DB/signing keys.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { nuxtPlatformEnv } from './platform-env.mjs'

process.on('uncaughtException', () => { console.error('WeCom configuration failed; credential diagnostics suppressed.'); process.exit(1) })
const root = '/wiztek/hzy-test'
const run = args => execFileSync('pm2', args, { stdio: 'pipe' })
if (process.argv[2] !== '--execute' || execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw new Error('Unexpected invocation')
const list = JSON.parse(run(['jlist']))
const prod = list.find(p => p.name === 'hzy-platform-prod'), dev = list.find(p => p.name === 'hzy-platform-dev')
if (!prod?.pid || !dev?.pid) throw new Error('Expected running processes')
const readEnv = p => Object.fromEntries(fs.readFileSync(`/proc/${p.pid}/environ`, 'utf8').split('\0').filter(Boolean).map(v => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)]))
const source = readEnv(prod), current = readEnv(dev)
const path = `${root}/platform-dev.config.json`
const config = JSON.parse(fs.readFileSync(path, 'utf8'))
const app = config.apps[0]
if (current.DB_NAME !== 'hzy_platform_dev' || current.PORT !== '3011' || app.name !== dev.name || app.cwd !== dev.pm2_env.pm_cwd) throw new Error('Development binding mismatch')
const copied = ['WECOM_CORPID', 'WECOM_CORPSECRET', 'WECOM_AGENTID', 'WECOM_OAUTH_ALLOWED_USERIDS']
if (copied.some(k => !source[k]) || copied.some(k => current[k])) throw new Error('Missing provider or existing test config; explicit merge required')
if (source.WECOM_OAUTH_ALLOW_ALL === 'true') throw new Error('Refusing unrestricted administrator provisioning')
const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken')
url.searchParams.set('corpid', source.WECOM_CORPID); url.searchParams.set('corpsecret', source.WECOM_CORPSECRET)
const upstream = await fetch(url, { signal: AbortSignal.timeout(10000) }).then(r => r.json())
if (upstream.errcode !== 0 || !upstream.access_token) throw new Error('Corporate provider unavailable')
const backup = `${root}/backups/platform-wecom-20260905`
fs.mkdirSync(backup, { mode: 0o700 })
fs.copyFileSync(path, `${backup}/platform-dev.config.json`, fs.constants.COPYFILE_EXCL)
fs.chmodSync(`${backup}/platform-dev.config.json`, 0o600)
for (const key of copied) app.env[key] = source[key]
app.env.WECOM_OAUTH_ALLOW_ALL = 'false'
app.env.WECOM_OAUTH_REDIRECT_URI = 'https://platform-dev.wiztek.cn/api/platform/auth/wecom/callback'
app.env.NUXT_PUBLIC_WECOM_ADMIN_LOGIN_ENABLED = 'true'
app.env = nuxtPlatformEnv(app.env)
fs.writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 })
try {
  run(['restart', path, '--only', 'hzy-platform-dev', '--update-env'])
  let valid = false
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch('http://127.0.0.1:3011/api/platform/auth/wecom/start', { redirect: 'manual', signal: AbortSignal.timeout(3000) })
      const location = new URL(response.headers.get('location') || 'http://invalid')
      if (response.status === 302 && location.host === 'open.work.weixin.qq.com' && location.searchParams.get('redirect_uri') === app.env.WECOM_OAUTH_REDIRECT_URI && location.searchParams.get('state')) { valid = true; break }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!valid) throw new Error('Development login redirect failed')
  const active = JSON.parse(run(['jlist']))
  if (active.find(p => p.name === prod.name)?.pid !== prod.pid || active.find(p => p.name === dev.name)?.pm2_env.pm_cwd !== app.cwd) throw new Error('Process isolation failed')
  run(['save'])
  fs.writeFileSync(`${backup}/receipt.json`, JSON.stringify({ configuredAt: new Date().toISOString(), callback: app.env.WECOM_OAUTH_REDIRECT_URI,
    providerTokenCheck: 'ok', oauthStartStatus: 302, allowAll: false, allowlistCount: source.WECOM_OAUTH_ALLOWED_USERIDS.split(',').filter(Boolean).length,
    productionPidUnchanged: true, browserLoginVerified: false }, null, 2), { mode: 0o600, flag: 'wx' })
  console.log('Development WeCom provider configured: HTTP 302, dev-only callback, existing corporate allowlist, mock login disabled. Production process unchanged. Browser authorization still needs verification.')
} catch (error) {
  fs.copyFileSync(`${backup}/platform-dev.config.json`, path)
  run(['restart', path, '--only', 'hzy-platform-dev', '--update-env'])
  throw error
}
