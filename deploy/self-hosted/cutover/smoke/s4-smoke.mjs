#!/usr/bin/env node
// S4 B17/B18 read-only smoke. Prints only PASS/FAIL/SKIP lines and counts: no tokens, secrets, cookies or response bodies.
// Run on the new host as root after the services are started (maintenance mode: B17/B18, open mode: after B19).
//   node s4-smoke.mjs --mode maintenance|open [--public-url https://aidcp.wiztek.cn] [--expected-kids kids.txt]
//        [--heartbeat-cmd "<prints one ISO timestamp>"] [--connector-heartbeat-cmd "<prints one ISO timestamp>"]
//        [--verify-views-cmd "<runs hzy-enterprise-verify-views>"] [--units-active 7] [--ports '{"console":31001,...}'] [--no-systemd]
// Anything that needs a human (browser login, scanning a QR code, Host pages) is in the MANUAL list at the end, not here.
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { parseArgs } from 'node:util'

const run = promisify(execFile)
const { values: opt } = parseArgs({ options: {
  'mode': { type: 'string', default: 'maintenance' }, 'public-url': { type: 'string', default: 'https://aidcp.wiztek.cn' },
  'expected-kids': { type: 'string' }, 'heartbeat-cmd': { type: 'string' }, 'connector-heartbeat-cmd': { type: 'string' },
  'verify-views-cmd': { type: 'string' }, 'units-active': { type: 'string', default: '7' }, 'ports': { type: 'string' },
  'no-systemd': { type: 'boolean', default: false }, 'max-heartbeat-age-s': { type: 'string', default: '600' }
} })
if (!['maintenance', 'open'].includes(opt.mode)) throw Error('--mode must be maintenance or open')
const ports = { gatewayIngress: 8780, gatewayHealth: 8781, runtime: 31080, console: 31001, enterprise: 31002, workflow: 31003, aims: 31004, codocs: 31005, ...(opt.ports ? JSON.parse(opt.ports) : {}) }
const local = (port, path) => `http://127.0.0.1:${port}${path}`
const results = []
const record = (status, name, detail = '') => { results.push(status); console.log(`${status} ${name}${detail ? ` — ${detail}` : ''}`) }
const get = async (url, init = {}) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), ...init })
const check = async (name, fn) => { try { const out = await fn(); if (out?.skip) record('SKIP', name, out.skip); else record(out === true || out?.ok ? 'PASS' : 'FAIL', name, out?.detail || '') } catch (e) { record('FAIL', name, `error: ${String(e.message || e).replace(/https?:\/\/\S+/g, '[url]').slice(0, 100)}`) } }
const ageOk = iso => { const t = Date.parse(iso); return Number.isFinite(t) && Math.abs(Date.now() - t) <= Number(opt['max-heartbeat-age-s']) * 1000 }
const shell = async (cmd) => (await run('/bin/sh', ['-c', cmd], { timeout: 60000, maxBuffer: 1 << 20 })).stdout.trim()

// 1. services
const APPS = ['console', 'enterprise', 'workflow', 'aims', 'codocs']
const appPath = app => app === 'aims' ? '/aims/api/internal/integration-operations/drain' : `/${app}/`
await check('units active', async () => {
  if (opt['no-systemd']) return { skip: 'no systemd here' }
  const units = [...APPS.map(a => `hzy-${a}`), 'hzy-tenant-gateway', 'hzy-data-runtime']
  let active = 0
  for (const unit of units) { try { await run('systemctl', ['is-active', '--quiet', unit]); active += 1 } catch { /* inactive */ } }
  return { ok: active === Number(opt['units-active']), detail: `${active}/${units.length} active, expected ${opt['units-active']}` }
})
for (const app of APPS) {
  await check(`health ${app}`, async () => { const r = await get(local(ports[app], appPath(app))); return { ok: r.status >= 200 && r.status < 500 && r.status !== 404, detail: `HTTP ${r.status}` } })
}
await check('health gateway readyz', async () => { const r = await get(local(ports.gatewayHealth, '/readyz')); return { ok: r.status === 200, detail: `HTTP ${r.status}` } })

// 2. Runtime
let runtimeHealth = null
const healthBody = () => runtimeHealth?.data && runtimeHealth.data.apps ? runtimeHealth.data : runtimeHealth
await check('runtime health', async () => {
  const r = await get(local(ports.runtime, '/runtime/health'))
  runtimeHealth = r.status === 200 ? await r.json().catch(() => null) : null
  const body = healthBody()
  const enabled = Object.values(body?.apps || {}).filter(a => a?.enabled)
  const down = enabled.filter(a => a.db !== 'ok').length
  return { ok: r.status === 200 && body?.status === 'ok' && enabled.length > 0 && down === 0, detail: `HTTP ${r.status}, status=${body?.status}, version=${body?.version}, ${enabled.length} adapters enabled, ${down} with db not ok` }
})
await check('runtime vault key configured', async () => {
  const consoleApp = healthBody()?.apps?.console
  if (!consoleApp) return { skip: 'runtime health unavailable' }
  return { ok: consoleApp.vaultKeyConfigured === true, detail: `vaultKeyConfigured=${consoleApp.vaultKeyConfigured}` }
})
await check('runtime heartbeat fresh', async () => {
  if (!opt['heartbeat-cmd']) return { skip: 'no --heartbeat-cmd' }
  const at = await shell(opt['heartbeat-cmd'])
  return { ok: ageOk(at), detail: `age ${Math.round((Date.now() - Date.parse(at)) / 1000)}s (limit ${opt['max-heartbeat-age-s']}s)` }
})

// 3. applications reach the local Console with the /console prefix (loopback)
for (const app of ['enterprise', 'workflow', 'aims', 'codocs']) {
  await check(`${app} boot log: Console config + service token`, async () => {
    if (opt['no-systemd']) return { skip: 'no systemd here' }
    const { stdout } = await run('journalctl', ['-u', `hzy-${app}`, '-n', '2000', '--no-pager', '-o', 'cat'], { timeout: 30000, maxBuffer: 16 << 20 })
    const failures = (stdout.match(/Failed to fetch runtime config|runtime config load failed|Console service token request failed|Console introspection failed|Self-hosted service topology is misconfigured/g) || []).length
    return { ok: failures === 0, detail: `${failures} failure lines in the last 2000 log lines` }
  })
}
await check('codocs rejects a bogus service token with 401/403 (introspection reached Console over loopback)', async () => {
  const r = await get(local(ports.codocs, '/codocs/api/v1/service/company-weekly-summaries/2026-W01:publish'), { method: 'POST', headers: { 'authorization': 'Bearer smoke-not-a-token', 'content-type': 'application/json' }, body: '{}' })
  return { ok: [401, 403].includes(r.status), detail: `HTTP ${r.status}` }
})

// 4. Console: JWKS, login configuration
await check('console JWKS kid set', async () => {
  const r = await get(local(ports.console, '/console/.well-known/jwks.json'))
  const kids = r.status === 200 ? ((await r.json()).keys || []).map(k => k.kid).sort() : []
  if (!opt['expected-kids']) return { ok: r.status === 200 && kids.length > 0, detail: `HTTP ${r.status}, ${kids.length} keys (no --expected-kids to compare)` }
  const expected = readFileSync(opt['expected-kids'], 'utf8').split('\n').map(s => s.trim()).filter(Boolean).sort()
  const missing = expected.filter(k => !kids.includes(k)).length
  return { ok: r.status === 200 && missing === 0, detail: `${kids.length} served, ${expected.length} expected, ${missing} missing, ${kids.filter(k => !expected.includes(k)).length} extra` }
})
let login = null
await check('login config: WeCom shown, DingTalk off, SSO on', async () => {
  const r = await get(local(ports.console, '/console/api/auth/login-config'))
  login = r.status === 200 ? (await r.json()).data : null
  if (!login) return { ok: false, detail: `HTTP ${r.status}` }
  const ok = Boolean(login.wecomCorpid) && Boolean(login.wecomAgentid) && !login.dingtalkClientId && login.ssoOidcEnable === true && (login.enabledProviders || []).includes('wecom') && !(login.enabledProviders || []).includes('dingtalk')
  return { ok, detail: `providers=${(login.enabledProviders || []).length}, wecom=${Boolean(login.wecomCorpid)}, dingtalk=${Boolean(login.dingtalkClientId)}, sso=${login.ssoOidcEnable}` }
})
await check('DingTalk login path answers 503 “未启用” (not 500/302)', async () => {
  const r = await get(local(ports.console, '/console/api/auth/dingtalk-login'))
  const body = await r.text()
  return { ok: r.status === 503 && body.includes('钉钉登录未启用'), detail: `HTTP ${r.status}` }
})
await check('WeCom login path redirects to WeCom', async () => {
  const r = await get(local(ports.console, '/console/api/auth/wecom-login'))
  const host = r.headers.get('location') ? new URL(r.headers.get('location'), 'http://x').host : ''
  return { ok: r.status === 302 && /weixin\.qq\.com$/.test(host), detail: `HTTP ${r.status}, redirect host ${host || '-'}` }
})

// 5. connector and views
await check('connector heartbeat fresh', async () => {
  if (!opt['connector-heartbeat-cmd']) return { skip: 'no --connector-heartbeat-cmd' }
  const at = await shell(opt['connector-heartbeat-cmd'])
  return { ok: ageOk(at), detail: `age ${Math.round((Date.now() - Date.parse(at)) / 1000)}s` }
})
await check('verify-views', async () => {
  if (!opt['verify-views-cmd']) return { skip: 'no --verify-views-cmd' }
  const out = await shell(opt['verify-views-cmd'])
  const m = out.match(/total:\s*(\d+)\/(\d+) views verified,.*?(\d+) failed/)
  return { ok: Boolean(m) && m[1] === m[2] && m[3] === '0', detail: m ? `${m[1]}/${m[2]} verified, ${m[3]} failed` : 'unrecognised output' }
})

// 6. public entry
if (opt.mode === 'maintenance') {
  await check('public entry is the maintenance page (503)', async () => {
    const r = await get(`${opt['public-url']}/`)
    return { ok: r.status === 503, detail: `HTTP ${r.status}` }
  })
} else {
  await check('public entry serves the Console login', async () => {
    const r = await get(`${opt['public-url']}/console/api/auth/login-config`)
    const data = r.status === 200 ? (await r.json()).data : null
    return { ok: Boolean(data?.wecomCorpid) && !data?.dingtalkClientId, detail: `HTTP ${r.status}` }
  })
  await check('public entry: unprefixed root reaches the Console (redirect, not 5xx)', async () => {
    const r = await get(`${opt['public-url']}/`)
    return { ok: [200, 301, 302, 303, 307, 308].includes(r.status), detail: `HTTP ${r.status}` }
  })
}

const count = status => results.filter(item => item === status).length
console.log(`\nSUMMARY mode=${opt.mode} PASS=${count('PASS')} FAIL=${count('FAIL')} SKIP=${count('SKIP')}`)
console.log(`MANUAL (not covered here):
 1. Keycloak browser login with a normal account (positive) and a revoked account (negative, must be refused).
 2. WeCom QR login: positive account logs in; a revoked account is refused and no session is created.
 3. Administrator opens Integrations, Vault, Service credentials read-only, without saving; the menu matches the old console.
 4. Host department documents show production rows (row count equals the restored hzy_codocs), and one document body opens (OSS read).
 5. Approver / project manager / member / unauthorised account positive and negative cases; revocation effective within 5 minutes.
 6. Workflow start/approve/callback round trip; fault injection listed in B18.
 7. Runtime schema status per app (\`GET /runtime/schema/status?app=…\` needs a service token with \`<app>.schema.read\`): run through the B14 token probe tooling, not here, to keep tokens out of this script.
 8. Log in and out from both Enterprise and Console: callback and post-logout land on the aidcp paths (/console/api/auth/..., /enterprise/...), no 302 loop on /api/auth/....`)
process.exitCode = count('FAIL') > 0 ? 1 : 0
