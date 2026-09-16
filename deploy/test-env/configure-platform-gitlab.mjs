#!/usr/bin/env node
// Explicitly authorized reuse of account/.env GitLab credentials on development only.
// Secrets travel through SSH stdin, never command arguments or diagnostic output.
import fs from 'node:fs'
import { parseEnv } from 'node:util'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function selectGitLabFields(env) {
  const baseUrl = String(env.GITLAB_BASE_URL || '').replace(/\/+$/, '')
  if (baseUrl !== 'https://gitlab.wiztek.cn' || !env.GITLAB_BOT_TOKEN?.trim()) throw new Error('Invalid GitLab source')
  // Bot email/username are not consumed by Platform; do not copy unrelated fields.
  return { GITLAB_BASE_URL: baseUrl, GITLAB_BOT_TOKEN: env.GITLAB_BOT_TOKEN.trim() }
}

async function configure(input) {
  const run = (command, args) => execFileSync(command, args, { stdio: 'pipe' })
  if (!['--check', '--execute'].includes(input.mode)
    || run('hostname', []).toString().trim() !== 'iZcqwiqyhp9u8rZ') throw new Error('Invocation')
  const fields = selectGitLabFields(input.fields)
  fields.NUXT_GITLAB_BASE_URL = fields.GITLAB_BASE_URL
  fields.NUXT_PUBLIC_GITLAB_BASE_URL = fields.GITLAB_BASE_URL
  fields.NUXT_GITLAB_TOKEN = fields.GITLAB_BOT_TOKEN
  const configPath = '/wiztek/hzy-test/platform-dev.config.json'
  const original = fs.readFileSync(configPath)
  const config = JSON.parse(original), app = config.apps[0]
  const processes = () => JSON.parse(run('pm2', ['jlist']))
  const before = processes(), dev = before.find(p => p.name === 'hzy-platform-dev')
  if (config.apps.length !== 1 || app.name !== dev?.name || !dev.pid
    || app.env.DB_NAME !== 'hzy_platform_dev' || String(app.env.PORT) !== '3011'
    || app.env.PLATFORM_SERVICE_URL !== 'https://hzy.wiztek.cn'
    || app.cwd !== '/wiztek/hzy-test/platform-release-5f898581/platform'
    || dev.pm2_env.pm_cwd !== app.cwd) throw new Error('Development isolation')
  for (const [key, value] of Object.entries(fields)) {
    if (app.env[key] && app.env[key] !== value) throw new Error('Existing configuration differs')
  }
  const get = async path => {
    const r = await fetch(`${fields.GITLAB_BASE_URL}/api/v4${path}`, {
      headers: { 'PRIVATE-TOKEN': fields.GITLAB_BOT_TOKEN },
      redirect: 'error', signal: AbortSignal.timeout(15000)
    })
    if (!r.ok) throw new Error('GitLab verification')
    return r.json()
  }
  const token = await get('/personal_access_tokens/self')
  if (!token.active || token.revoked || !token.scopes?.includes('api')) throw new Error('Active API-write token required')
  const projectPath = encodeURIComponent('huizhi-yun/huizhiyun')
  const project = await get(`/projects/${projectPath}`)
  if (project.path_with_namespace !== 'huizhi-yun/huizhiyun' || project.archived) throw new Error('Project')
  const manifest = await get(`/projects/${projectPath}/repository/files/${encodeURIComponent('people/app.manifest.json')}?ref=${encodeURIComponent('people/v0.1.6')}`)
  if (manifest.encoding !== 'base64' || !manifest.content) throw new Error('Manifest')
  JSON.parse(Buffer.from(manifest.content, 'base64').toString())
  const report = { mode: input.mode, active: true, scopes: token.scopes, expiresAt: token.expires_at,
    projectAccessLevel: project.permissions?.project_access?.access_level ?? null,
    groupAccessLevel: project.permissions?.group_access?.access_level ?? null,
    manifestRead: true, commit: manifest.commit_id, gitlabWritesPerformed: false }
  console.log(JSON.stringify(report))
  if (input.mode !== '--execute') return
  if (Object.entries(fields).every(([key, value]) => app.env[key] === value
    && dev.pm2_env[key] === value)) { console.log('Development GitLab configuration already matches.'); return }
  const backup = fs.mkdtempSync('/wiztek/hzy-test/backups/platform-gitlab-reuse-')
  fs.chmodSync(backup, 0o700)
  fs.writeFileSync(`${backup}/platform-dev.config.json`, original, { mode: 0o600, flag: 'wx' })
  const writeConfig = data => {
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), { mode: 0o600 })
    fs.chmodSync(configPath, 0o600)
  }
  Object.assign(app.env, fields)
  writeConfig(config)
  try {
    run('pm2', ['restart', configPath, '--only', app.name, '--update-env'])
    let ready = false
    for (let i = 0; i < 20; i++) {
      try {
        const r = await fetch('http://127.0.0.1:3011/login', { redirect: 'manual', signal: AbortSignal.timeout(2000) })
        if (r.status === 200) { ready = true; break }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    const after = processes(), live = after.find(p => p.name === app.name)
    if (!ready || live?.pm2_env.status !== 'online'
      || !Object.entries(fields).every(([key, value]) => live.pm2_env[key] === value)
      || before.filter(p => p.name !== app.name).some(p => after.find(q => q.name === p.name)?.pid !== p.pid)) throw new Error('Restart verification')
    run('pm2', ['save'])
    fs.writeFileSync(`${backup}/complete.json`, JSON.stringify({ ...report, completedAt: new Date().toISOString(),
      otherProcessesUnchanged: true, source: 'user-authorized account/.env', fields: Object.keys(fields) }), { mode: 0o600, flag: 'wx' })
    console.log(JSON.stringify({ configured: true, backup, otherProcessesUnchanged: true }))
  } catch (error) {
    // PM2 merges environment: rollback must explicitly clear introduced keys.
    const rollback = JSON.parse(original)
    for (const key of Object.keys(fields)) rollback.apps[0].env[key] ??= ''
    writeConfig(rollback)
    run('pm2', ['restart', configPath, '--only', app.name, '--update-env'])
    run('pm2', ['save'])
    throw error
  }
}

async function main() {
  if (globalThis.gitlabReuseInput) return configure(globalThis.gitlabReuseInput)
  const mode = process.argv[2] || '--check'
  if (!['--check', '--execute'].includes(mode)) throw new Error('Mode')
  execFileSync('git', ['check-ignore', '--quiet', 'account/.env'], { stdio: 'pipe' })
  const fields = selectGitLabFields(parseEnv(fs.readFileSync('account/.env', 'utf8')))
  const source = fs.readFileSync(new URL(import.meta.url), 'utf8').replace(/^#!.*\n/, '')
  const output = execFileSync('ssh', ['-o', 'BatchMode=yes', 'root@gitlab.wiztek.cn', 'node --input-type=module'], {
    input: `globalThis.gitlabReuseInput = ${JSON.stringify({ mode, fields })};\n${source}`,
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000
  })
  process.stdout.write(output)
}
if (globalThis.gitlabReuseInput || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  main().catch(() => { console.error('GitLab setup stopped; credential-bearing diagnostics suppressed.'); process.exitCode = 1 })
}
