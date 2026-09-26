import { resolve } from 'node:path'

const names = new Set(['hzy0-gateway', 'hzy0-enterprise', 'hzy0-codocs-editor', 'hzy0-console', 'hzy0-collab', 'hzy0-workflow', 'hzy0-aims'])

// A dedicated PM2_HOME is insufficient if an unrelated process uses its names.
// Only return summaries; PM2 environments/log buffers can contain credentials.
export function ownedProcesses(rows, { root, profilePath, mode }) {
  if (!Array.isArray(rows)) throw Error('Invalid PM2 process inventory')
  const selected = rows.filter(row => names.has(row.name))
  if (new Set(selected.map(row => row.name)).size !== selected.length) throw Error('Duplicate local process names')
  for (const row of selected) {
    const env = row.pm2_env || {}
    const expected = ['--app', row.name.slice('hzy0-'.length), '--profile', profilePath, '--mode', mode]
    if (env.pm_cwd !== root || env.pm_exec_path !== resolve(root, 'deploy/test-env/local-enterprise/run-process.mjs')
      || !Array.isArray(env.args) || JSON.stringify(env.args) !== JSON.stringify(expected)) {
      throw Error(`Refusing to manage unowned or different-mode process: ${row.name}`)
    }
  }
  return selected.map(row => ({ name: row.name, pid: row.pid, status: row.pm2_env.status, restarts: row.pm2_env.restart_time }))
}
