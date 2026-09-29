import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { bundleCollab } from '../bundle-collab.mjs'
import { checkLoopbackListener } from '../collab-probe.mjs'
import { localHealth } from '../release.mjs'
import { APPS, BASE_PATHS, PORTS, createManifest, verifyManifest } from '../release-lib.mjs'

const base = dirname(dirname(fileURLToPath(import.meta.url)))
const repo = join(base, '../..')
const read = path => readFile(join(base, path), 'utf8')
const settings = text => Object.fromEntries(text.split('\n').filter(line => /^[A-Z][A-Z0-9_]*=/.test(line)).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
const commit = 'a'.repeat(40)

test('collab is a first-class release component on its own loopback port', async () => {
  assert.ok(APPS.includes('collab'))
  assert.equal(PORTS.collab, 31007)
  assert.ok(BASE_PATHS.collab)
  assert.equal(new Set(Object.values(PORTS)).size, Object.values(PORTS).length, 'ports are unique')
  const env = settings(await read('env/collab.env.example'))
  assert.equal(env.COLLAB_ADDRESS, '127.0.0.1')
  assert.equal(env.COLLAB_PORT, String(PORTS.collab))
  const gateway = JSON.parse(await read('gateway/gateway.config.example.json'))
  assert.equal(gateway.apps.collab.origin, `http://127.0.0.1:${PORTS.collab}`)
  assert.match(gateway.apps.collab.deploymentCode, /^REPLACE_.*-collab$/)
  const readme = await read('README.md')
  assert.match(readme, /hzy-collab\.service/)
  assert.match(readme, new RegExp(`\\| Collab[^|\\n]*\\|[^\\n]*127\\.0\\.0\\.1:${PORTS.collab}`))
})

test('release ordering starts collab after codocs and before the Host and Gateway', async () => {
  const source = await read('release.mjs')
  assert.match(source, /'codocs', 'collab', 'enterprise', 'gateway'/)
})

test('collab.env.example carries placeholders and only the keys the Collab code reads', async () => {
  const env = settings(await read('env/collab.env.example'))
  const config = await readFile(join(repo, 'collab/src/config.ts'), 'utf8')
  const authentication = await readFile(join(repo, 'collab/src/utils/collaboration-auth.ts'), 'utf8')
  for (const key of Object.keys(env)) {
    if (['NODE_ENV', 'HZY_APP_RUN_MODE', 'HZY_PLATFORM_ENVIRONMENT'].includes(key)) continue
    assert.ok(config.includes(key), `${key} is not read by collab/src/config.ts`)
  }
  assert.match(env.COLLAB_SERVICE_CLIENT_SECRET, /^REPLACE_/)
  assert.equal(env.COLLAB_SERVICE_CLIENT_ID, 'collab.runtime')
  assert.equal(env.COLLAB_V2_ENABLED, 'true')
  assert.equal(env.COLLAB_REDIS_DISABLED, 'true')
  assert.equal(env.COLLAB_RUNTIME_MODE, 'standalone')
  assert.match(env.COLLAB_CONSOLE_TOKEN_URL, /^https:\/\/[^/]+\/console\/oauth\/token$/)
  // G-10: Collab's plain fetch dials the Runtime loopback origin, identical to the app units' dial origin.
  const codocs = settings(await read('env/codocs.env.example'))
  assert.equal(env.COLLAB_CODOCS_RUNTIME_URL, codocs.HZY_SELF_HOSTED_RUNTIME_DIAL_ORIGIN)
  assert.equal(env.COLLAB_CODOCS_RUNTIME_URL, `http://127.0.0.1:${PORTS.runtime}`)
  // No static Runtime token, legacy HMAC secret, database or object-storage material.
  for (const key of Object.keys(env)) assert.doesNotMatch(key, /RUNTIME_TOKEN|AUTH_SECRET|^DB_|OSS_|ALIYUN|VAULT|SIGNING|REDIS_(HOST|PASSWORD)/, key)
  assert.match(authentication, /collaboration-auth-secret-missing/, 'production without the secret keeps the v1 HMAC path closed')
  assert.doesNotMatch(await read('env/collab.env.example'), /^(COLLAB_CODOCS_RUNTIME_TOKEN|COLLABORATION_AUTH_SECRET)=/m)
})

test('collab unit is hardened at least as strictly as the other application units and runs the health gate', async () => {
  const unit = await read('systemd/hzy-collab.service')
  const codocs = await read('systemd/hzy-codocs.service')
  const directives = text => new Set(text.split('\n').filter(line => /^[A-Za-z]+=/.test(line)).map(line => line.split('=')[0]))
  for (const name of ['NoNewPrivileges', 'PrivateTmp', 'ProtectSystem', 'ProtectHome', 'ProtectKernelTunables', 'ProtectKernelModules',
    'ProtectControlGroups', 'RestrictAddressFamilies', 'UMask', 'LimitNOFILE', 'Restart', 'StartLimitBurst', 'KillSignal']) {
    assert.ok(directives(unit).has(name), name)
    assert.ok(directives(codocs).has(name), `reference unit has ${name}`)
  }
  assert.match(unit, /^User=hzy-collab$/m)
  assert.match(unit, /^EnvironmentFile=\/etc\/hzy\/collab\.env$/m)
  assert.match(unit, /^NoNewPrivileges=true$/m)
  assert.match(unit, /^ProtectSystem=strict$/m)
  assert.match(unit, /^ProtectHome=read-only$/m)
  assert.match(unit, /^RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX$/m)
  assert.match(unit, /^CapabilityBoundingSet=$/m)
  assert.match(unit, /^Environment=DOTENV_CONFIG_PATH=\/dev\/null$/m)
  assert.match(unit, /^Requires=hzy-data-runtime\.service$/m)
  assert.match(unit, /^ExecStartPre=.*verify\.mjs --dir \/home\/hzy\/apps\/collab\/current --app collab$/m)
  assert.match(unit, /^ExecStart=.*\/home\/hzy\/apps\/collab\/current\/\.output\/server\/index\.mjs$/m)
  assert.match(unit, /^ExecStartPost=.*health\.mjs --app collab$/m)
  assert.doesNotMatch(unit, /^(Environment|EnvironmentFile)=.*(SECRET|PASSWORD|TOKEN)/m)
})

test('Host and Console templates keep collaboration off by default and name the flags the code reads', async () => {
  const enterprise = settings(await read('env/enterprise.env.example'))
  for (const key of ['HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2', 'HZY_ENTERPRISE_CODOCS_COLLABORATION_V2', 'NUXT_PUBLIC_CODOCS_COLLABORATION_V2', 'HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2', 'NUXT_PUBLIC_CODOCS_DEPARTMENT_COLLABORATION_V2']) assert.equal(enterprise[key], 'false', key)
  const collaboration = await readFile(join(repo, 'enterprise/server/utils/enterpriseCodocsCollaboration.ts'), 'utf8')
  const nuxt = await readFile(join(repo, 'enterprise/nuxt.config.ts'), 'utf8')
  assert.match(collaboration, /process\.env\.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 === 'true' && process\.env\.HZY_ENTERPRISE_CODOCS_COLLABORATION_V2 === 'true'/)
  assert.match(nuxt, /codocsCollaborationV2: process\.env\.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 === 'true'/)
  // The public page switch is a build-time default; the release build never sets the server flags.
  const build = await read('build.mjs')
  assert.doesNotMatch(build, /CODOCS_(SNAPSHOT|COLLABORATION)_V2/)
  assert.equal(settings(await read('env/console.env.example')).CONSOLE_COLLAB_MODE, 'disabled')
  const runtimeConfig = await readFile(join(repo, 'data-runtime/internal/config/config.go'), 'utf8')
  assert.match(runtimeConfig, /json:"snapshotV2Enabled"/)
  assert.match(runtimeConfig, /json:"collaborationV2Enabled"/)
  assert.match(runtimeConfig, /json:"departmentCollaborationV2Enabled"/)
  assert.match(nuxt, /codocsDepartmentCollaborationV2: .*HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2 === 'true'/)
  const departmentHost = await readFile(join(repo, 'enterprise/server/utils/enterpriseCodocsDepartmentCollaboration.ts'), 'utf8')
  assert.match(departmentHost, /process\.env\.HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2 === 'true'/)
  // The runtime template documents the config.json keys and stays free of secrets and enabled flags.
  const runtimeTemplate = await read('env/runtime.env.example')
  assert.match(runtimeTemplate, /departmentCollaborationV2Enabled/)
  assert.doesNotMatch(runtimeTemplate, /^\s*[A-Za-z_]*(COLLABORATION|SNAPSHOT)[A-Za-z_]*=/m)
})

test('public nginx example upgrades /codocs/ws with 600 second timeouts above the Gateway idle timeout', async () => {
  const readme = await read('gateway/README.md')
  const block = /location = \/codocs\/ws \{([\s\S]*?)\n  \}/.exec(readme)?.[1]
  assert.ok(block, 'exact-match /codocs/ws location present')
  for (const line of ['proxy_http_version 1.1;', 'proxy_set_header Upgrade $http_upgrade;', 'proxy_set_header Connection $connection_upgrade;',
    'proxy_set_header Host $host;', 'proxy_buffering off;', 'proxy_read_timeout 600s;', 'proxy_send_timeout 600s;']) assert.ok(block.includes(line), line)
  assert.match(readme, /map \$http_upgrade \$connection_upgrade \{/)
  const gateway = JSON.parse(await read('gateway/gateway.config.example.json'))
  assert.ok(600_000 >= gateway.limits.webSocketIdleTimeoutMs)
})

test('collab payload rules reject configuration files and embedded client secrets', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hzy-collab-payload-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  async function stage(name, extra = {}, bundle = 'export default 1\n') {
    const dir = join(root, name)
    await mkdir(join(dir, '.output/server'), { recursive: true })
    await writeFile(join(dir, '.output/server/index.mjs'), bundle)
    await writeFile(join(dir, '.output/package.json'), '{"type":"module"}\n')
    for (const [path, content] of Object.entries(extra)) await writeFile(join(dir, path), content)
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(await createManifest(dir, { app: 'collab', version: 'v1', commit, nodeVersion: 'v24.18.0' })))
    return dir
  }
  await verifyManifest(await stage('clean'), { app: 'collab', version: 'v1' })
  await assert.rejects(verifyManifest(await stage('env', { '.env': 'A=1\n' })), /configuration or key file/)
  await assert.rejects(verifyManifest(await stage('key', { 'signing.pem': 'x' })), /configuration or key file/)
  await assert.rejects(verifyManifest(await stage('secret', {}, 'const c={COLLAB_SERVICE_CLIENT_SECRET:"abcdefghijkl"}\n')), /client secret literal/)
  // Reading the variable name is fine.
  await verifyManifest(await stage('reads', {}, 'const s=process.env.COLLAB_SERVICE_CLIENT_SECRET\n'), { app: 'collab' })
  // Partial payload.
  const partial = join(root, 'partial')
  await mkdir(join(partial, '.output/server'), { recursive: true })
  await writeFile(join(partial, '.output/server/index.mjs'), 'x')
  await writeFile(join(partial, 'manifest.json'), JSON.stringify(await createManifest(partial, { app: 'collab', version: 'v1', commit, nodeVersion: 'v24.18.0' })))
  await assert.rejects(verifyManifest(partial), /missing \.output\/package\.json/)
})

test('loopback listener check passes for 127.0.0.1 only and rejects an all-interface bind', async (t) => {
  const listen = (host) => new Promise((resolve) => { const server = createServer((_, res) => res.end()); server.listen(0, host, () => resolve(server)) })
  const only = await listen('127.0.0.1')
  t.after(() => new Promise(resolve => only.close(resolve)))
  // ::1 is not served by a 127.0.0.1 bind (refused or unavailable) so no exposure is reported.
  assert.deepEqual(await checkLoopbackListener({ port: only.address().port, interfaces: () => ({ lo: [{ internal: false, address: '::1', family: 'IPv6' }] }) }), { loopback: true })
  // Any listener that also answers on a non-internal address is refused. 127.0.0.1 stands in for that address.
  await assert.rejects(checkLoopbackListener({ port: only.address().port, interfaces: () => ({ eth0: [{ internal: false, address: '127.0.0.1', family: 'IPv4' }] }) }), /beyond loopback/)
  // Link-local and internal entries are ignored; nothing listening on loopback fails.
  await checkLoopbackListener({ port: only.address().port, interfaces: () => ({ lo: [{ internal: true, address: '127.0.0.1', family: 'IPv4' }], x: [{ internal: false, address: 'fe80::1', family: 'IPv6' }] }) })
  const closed = await listen('127.0.0.1')
  const port = closed.address().port
  await new Promise(resolve => closed.close(resolve))
  await assert.rejects(checkLoopbackListener({ port, interfaces: () => ({}) }), /not listening on 127\.0\.0\.1/)
  await assert.rejects(checkLoopbackListener({ port: 0 }), /port invalid/)
})

test('localHealth accepts only the Collab health document, not its welcome page', async (t) => {
  const serve = (handler) => new Promise((resolve) => { const server = createServer(handler); server.listen(0, '127.0.0.1', () => resolve(server)) })
  const healthy = await serve((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(req.url === '/healthz' ? JSON.stringify({ code: 0, data: { healthy: true } }) : 'Welcome to Hocuspocus!') })
  const welcomeOnly = await serve((_, res) => { res.writeHead(200); res.end('Welcome to Hocuspocus!') })
  t.after(() => Promise.all([healthy, welcomeOnly].map(server => new Promise(resolve => server.close(resolve)))))
  await localHealth('collab', { port: healthy.address().port, attempts: 1 })
  await assert.rejects(localHealth('collab', { port: welcomeOnly.address().port, attempts: 1 }), /health probe failed: collab/)
})

test('the real Collab bundle builds, verifies, starts on loopback and reports healthy', { skip: !existsSync(join(repo, 'collab/node_modules/tsx')) && 'collab dependencies are not installed' }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hzy-collab-bundle-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = join(root, 'collab-test')
  await bundleCollab({ repo, outDir: dir })
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(await createManifest(dir, { app: 'collab', version: 'test', commit, nodeVersion: 'v24.18.0' })))
  await verifyManifest(dir, { app: 'collab', version: 'test' })
  const free = await new Promise((resolve) => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)) }) })
  const child = spawn(process.execPath, [join(dir, '.output/server/index.mjs')], {
    cwd: root, stdio: 'ignore',
    env: { PATH: process.env.PATH, NODE_ENV: 'production', DOTENV_CONFIG_PATH: '/dev/null', COLLAB_RUNTIME_MODE: 'standalone', COLLAB_ADDRESS: '127.0.0.1',
      COLLAB_PORT: String(free), COLLAB_REDIS_DISABLED: 'true', COLLAB_PUBLIC_BASE_PATH: '/codocs/', COLLAB_CODOCS_RUNTIME_URL: 'http://127.0.0.1:1' }
  })
  t.after(() => child.kill('SIGTERM'))
  await localHealth('collab', { port: free, attempts: 15 })
  await checkLoopbackListener({ port: free })
  // Regression: unpatched Hocuspocus binds the wildcard address despite COLLAB_ADDRESS.
  const v6 = await new Promise((resolve) => { const socket = connect({ host: '::1', port: free }); socket.once('connect', () => { socket.destroy(); resolve(true) }); socket.once('error', () => resolve(false)) })
  assert.equal(v6, false, 'collab must not answer on ::1 (wildcard bind)')
  assert.ok((await readFile(join(dir, '.output/server/index.mjs'), 'utf8')).includes('__hzyNetServer.prototype.listen'))
})
