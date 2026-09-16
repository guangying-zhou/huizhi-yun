#!/usr/bin/env node
// Narrow hotfix for the existing development build; source routes carry the durable fix.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function fixRouteTable(source) {
  const pattern = /route: '(\/api\/platform\/(?:ops|admin|tenant-admin|_handlers)\/applications\/)\:id(?=['/])/g
  const count = [...source.matchAll(pattern)].length
  if (count !== 16) throw new Error('Unexpected development route table')
  return source.replace(pattern, "route: '$1:appCode")
}
export function fixHandler(source) {
  const pattern = /getRouterParam\(event, "id"\)/g
  if ([...source.matchAll(pattern)].length !== 1) throw new Error('Unexpected compiled application handler')
  return source.replace(pattern, 'getRouterParam(event, "appCode")')
}
async function main() {
  const run = (command, args) => execFileSync(command, args, { stdio: 'pipe' })
  if (process.argv[2] !== '--execute' || run('hostname', []).toString().trim() !== 'iZcqwiqyhp9u8rZ') throw new Error('Invocation')
  const processes = () => JSON.parse(run('pm2', ['jlist']))
  const before = processes(), app = before.find(p => p.name === 'hzy-platform-dev')
  const cwd = '/wiztek/hzy-test/platform-release-5f898581/platform'
  if (!app?.pid || app.pm2_env.DB_NAME !== 'hzy_platform_dev' || app.pm2_env.pm_cwd !== cwd) throw new Error('Development guard')
  const paths = ['chunks/nitro/nitro.mjs', ...['get', 'patch', 'delete'].map(m =>
    `chunks/routes/api/platform/tenant-admin/applications/_id_.${m}.mjs`)]
  const edits = paths.map((path, i) => {
    const full = `${cwd}/.output/server/${path}`
    const original = fs.readFileSync(full, 'utf8')
    return { path, full, original, next: i === 0 ? fixRouteTable(original) : fixHandler(original) }
  })
  const backup = '/wiztek/hzy-test/backups/platform-application-routes-20260905'
  fs.mkdirSync(backup, { mode: 0o700 })
  for (const [i, edit] of edits.entries()) {
    fs.writeFileSync(`${backup}/${i}.original.mjs`, edit.original, { mode: 0o600, flag: 'wx' })
    fs.writeFileSync(`${backup}/${i}.next.mjs`, edit.next, { mode: 0o600, flag: 'wx' })
    run('node', ['--check', `${backup}/${i}.next.mjs`])
  }
  fs.writeFileSync(`${backup}/paths.json`, JSON.stringify(paths), { mode: 0o600, flag: 'wx' })
  try {
    for (const edit of edits) {
      if (fs.readFileSync(edit.full, 'utf8') !== edit.original) throw new Error('Drift')
      fs.writeFileSync(edit.full, edit.next)
    }
    run('pm2', ['restart', 'hzy-platform-dev'])
    let ready = false
    for (let i = 0; i < 15; i++) {
      try {
        const r = await fetch('http://127.0.0.1:3011/login', { signal: AbortSignal.timeout(2000) })
        if (r.status === 200) { ready = true; break }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    const after = processes()
    if (!ready || before.filter(p => p.name !== app.name).some(p => after.find(q => q.name === p.name)?.pid !== p.pid)) throw new Error('Restart verification')
    const report = { completedAt: new Date().toISOString(), files: paths.length, otherProcessesUnchanged: true, backup }
    fs.writeFileSync(`${backup}/complete.json`, JSON.stringify(report), { mode: 0o600, flag: 'wx' })
    console.log(JSON.stringify(report))
  } catch (error) {
    for (const edit of edits) fs.writeFileSync(edit.full, edit.original)
    run('pm2', ['restart', 'hzy-platform-dev'])
    throw error
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Development route hotfix stopped; private process diagnostics suppressed.'); process.exitCode = 1 })
}
