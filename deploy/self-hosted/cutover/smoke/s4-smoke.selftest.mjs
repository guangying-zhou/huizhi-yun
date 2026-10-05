// Self-test for s4-smoke.mjs with stand-in servers: proves the script runs, passes on a healthy picture, and FAILs when it should.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./s4-smoke.mjs', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 's4-smoke-'))
const servers = []
const listen = handler => new Promise(resolve => { const s = createServer(handler); s.listen(0, '127.0.0.1', () => { servers.push(s); resolve(s.address().port) }) })
const json = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
const state = { dingtalk: '', maintenancePublic: true, wecom: 'wwtest' }

const consolePort = await listen((req, res) => {
  const url = req.url.split('?')[0]
  if (url === '/console/') return res.writeHead(200).end('ok')
  if (url === '/console/.well-known/jwks.json') return json(res, 200, { keys: [{ kid: 'k1' }, { kid: 'k2' }] })
  if (url === '/console/api/auth/login-config') return json(res, 200, { code: 200, data: { enabledProviders: ['oidc', 'wecom'], ssoOidcEnable: true, wecomCorpid: state.wecom, wecomAgentid: '1000007', dingtalkClientId: state.dingtalk } })
  if (url === '/console/api/auth/dingtalk-login') return json(res, 503, { message: '钉钉登录未启用' })
  if (url === '/console/api/auth/wecom-login') return res.writeHead(302, { location: 'https://open.work.weixin.qq.com/wwopen/sso/qrConnect?x=1' }).end()
  res.writeHead(404).end()
})
const appPort = () => listen((req, res) => res.writeHead(200).end('ok'))
const [enterprise, workflow, aims] = [await appPort(), await appPort(), await appPort()]
const codocs = await listen((req, res) => { req.resume(); res.writeHead(401).end() })
const runtime = await listen((req, res) => json(res, 200, { status: 'ok', version: '0.3.221', apps: { console: { enabled: true, db: 'ok', vaultKeyConfigured: true }, workflow: { enabled: true, db: 'ok' }, aims: { enabled: false } } }))
const gateway = await listen((req, res) => res.writeHead(200).end('ok'))
const publicPort = await listen((req, res) => {
  if (state.maintenancePublic) return res.writeHead(503).end('maintenance')
  if (req.url.startsWith('/console/api/auth/login-config')) return json(res, 200, { data: { wecomCorpid: 'wwtest', dingtalkClientId: '' } })
  res.writeHead(302, { location: '/console/' }).end()
})
writeFileSync(join(dir, 'kids.txt'), 'k1\nk2\n')
const ports = JSON.stringify({ console: consolePort, enterprise, workflow, aims, codocs, runtime, gatewayHealth: gateway })
const now = 'node -e "console.log(new Date().toISOString())"'
const views = 'echo "total: 142/142 views verified, 0 ambiguous mappings resolved by exact definition, 0 failed, mapping_hash=x"'
const args = mode => ['--mode', mode, '--no-systemd', '--ports', ports, '--public-url', `http://127.0.0.1:${publicPort}`, '--expected-kids', join(dir, 'kids.txt'),
  '--heartbeat-cmd', now, '--connector-heartbeat-cmd', now, '--verify-views-cmd', views]
const exec = mode => new Promise(resolve => execFile('node', [script, ...args(mode)], (error, stdout) => resolve({ code: error?.code ?? 0, out: stdout })))
try {
  state.maintenancePublic = true
  let r = await exec('maintenance')
  assert.equal(r.code, 0, r.out); assert.match(r.out, /SUMMARY mode=maintenance PASS=\d+ FAIL=0 SKIP=\d+/); assert.match(r.out, /PASS public entry is the maintenance page/)
  assert.doesNotMatch(r.out, /Bearer|smoke-not-a-token|k1|k2|wwtest/, 'output carries no credential, key id or configuration value')
  state.maintenancePublic = false
  r = await exec('open')
  assert.equal(r.code, 0, r.out); assert.match(r.out, /PASS public entry serves the Console login/)
  state.dingtalk = 'dingtest'
  r = await exec('open')
  assert.equal(r.code, 1); assert.match(r.out, /FAIL login config: WeCom shown, DingTalk off, SSO on/)
  state.dingtalk = ''; state.wecom = ''
  r = await exec('open')
  assert.equal(r.code, 1); assert.match(r.out, /FAIL login config/)
  console.log('s4-smoke self-test: OK (maintenance PASS, open PASS, DingTalk-on FAIL, WeCom-off FAIL, no credentials in output)')
} finally {
  for (const s of servers) s.close()
  rmSync(dir, { recursive: true, force: true })
}
