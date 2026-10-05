#!/usr/bin/env node
// Configure only public release trust on the existing development control plane.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createPublicKey, createHash } from 'node:crypto'
const run = (command, args) => execFileSync(command, args, { stdio: 'pipe' })
async function main() {
  if (run('hostname', []).toString().trim() !== 'iZcqwiqyhp9u8rZ') throw new Error('host')
  const root = '/wiztek/hzy-test', configPath = `${root}/platform-dev.config.json`
  const config = JSON.parse(fs.readFileSync(configPath)), app = config.apps[0]
  if (app.name !== 'hzy-platform-dev' || app.env.DB_NAME !== 'hzy_platform_dev'
    || app.env.PLATFORM_SERVICE_URL !== 'https://hzy.wiztek.cn' || String(app.env.PORT) !== '3011') throw new Error('binding')
  const publicKey = fs.readFileSync(`${root}/release-signing-public.pem`, 'utf8')
  const key = createPublicKey(publicKey)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('key')
  const keyId = createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex')
  const fields = {
    HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_PEM: publicKey,
    NUXT_DATA_RUNTIME_RELEASE_RELEASE_PUBLIC_KEY_PEM: publicKey,
    // Release/install metadata requires HTTPS in the deployed Node build.
    // This does not change the existing test Runtime's local Console issuer.
    HZY_DATA_RUNTIME_JWT_ISSUER: 'https://hzy-test.huizhi.yun',
    NUXT_DATA_RUNTIME_RELEASE_JWT_ISSUER: 'https://hzy-test.huizhi.yun'
  }
  for (const [name, value] of Object.entries(fields)) {
    if (app.env[name] && app.env[name] !== value) throw new Error('existing config needs review')
  }
  console.log(JSON.stringify({ mode: process.argv[2], keyId, fields: Object.keys(fields), approvedVersionOverride: false }))
  if (process.argv[2] !== '--execute') return
  const processes = JSON.parse(run('pm2', ['jlist']))
  const productionPid = processes.find(p => p.name === 'hzy-platform-prod')?.pid
  const backup = `${root}/backups/platform-release-trust-https-20260905`
  fs.mkdirSync(backup, { mode: 0o700 })
  fs.copyFileSync(configPath, `${backup}/platform-dev.config.json`, fs.constants.COPYFILE_EXCL)
  fs.chmodSync(`${backup}/platform-dev.config.json`, 0o600)
  Object.assign(app.env, fields)
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 })
  try {
    run('pm2', ['restart', configPath, '--only', 'hzy-platform-dev', '--update-env'])
    let ready = false
    for (let i = 0; i < 20; i++) {
      try {
        const r = await fetch('http://127.0.0.1:3011/api/v1/runtime/release-public-key', { signal: AbortSignal.timeout(2000) })
        if (r.ok) {
          const received = createPublicKey(await r.text())
          if (createHash('sha256').update(received.export({ type: 'spki', format: 'der' })).digest('hex') === keyId) { ready = true; break }
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (!ready) throw new Error('release key endpoint')
    if (JSON.parse(run('pm2', ['jlist'])).find(p => p.name === 'hzy-platform-prod')?.pid !== productionPid) throw new Error('production drift')
    run('pm2', ['save'])
    fs.writeFileSync(`${backup}/complete.json`, JSON.stringify({ completedAt: new Date().toISOString(), keyId, productionPidUnchanged: true }), { flag: 'wx', mode: 0o600 })
    console.log('Development release public trust configured and verified. Production process unchanged; release approval remains an Admin action.')
  } catch (error) {
    // PM2 merges env on restart: explicitly clear newly introduced fields.
    const previous = JSON.parse(fs.readFileSync(`${backup}/platform-dev.config.json`))
    for (const name of Object.keys(fields)) previous.apps[0].env[name] ??= ''
    fs.writeFileSync(configPath, JSON.stringify(previous, null, 2), { mode: 0o600 })
    run('pm2', ['restart', configPath, '--only', 'hzy-platform-dev', '--update-env'])
    throw error
  }
}
main().catch(() => { console.error('Release trust setup stopped; protected details suppressed.'); process.exitCode = 1 })
