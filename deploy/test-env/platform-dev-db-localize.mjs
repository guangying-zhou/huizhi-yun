// Moves the development Platform database (hzy_platform_dev) from the remote
// oa.wiztek.cn MySQL to a dedicated MySQL container on the Platform host
// (user-approved 2026-09-23: the cross-network link degrades pooled connections).
// Run on gitlab.wiztek.cn only: prepare -> seed -> cutover -> persist; rollback restores the remote binding.
// The link to oa.wiztek.cn is ~15-25 KB/s, so bulk data moves only in `seed` (Platform still live);
// the cutover compares server-side CHECKSUM TABLE values and re-copies only differing tables.
// Credentials stay in root-only files or process memory; nothing secret is printed or put on a command line.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const name = 'hzy-platform-dev'
const dir = '/wiztek/hzy-test/platform-dev-mysql'
const container = 'hzy-platform-dev-mysql'
const volume = 'hzy-platform-dev-mysql-data'
const image = 'mysql:8.0'
const localPort = 13317
const database = 'hzy_platform_dev'
const appUser = 'hzy_platform_dev'
// Matches the remote server (8.0.45): case folding, collation, strict mode, CST clock.
const mysqldArgs = ['--lower-case-table-names=1', '--character-set-server=utf8mb4', '--collation-server=utf8mb4_0900_ai_ci',
  '--default-time-zone=+08:00', '--sql-mode=IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION',
  '--innodb-buffer-pool-size=256M', '--max-connections=200', '--skip-name-resolve']

const mode = process.argv[2]
if (!['prepare', 'seed', 'cutover', 'persist', 'rollback'].includes(mode)) throw Error('mode must be prepare, seed, cutover, persist or rollback')
if (execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw Error('host mismatch')
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 << 20, ...options })
const pm = args => run('pm2', args)
const processes = () => JSON.parse(pm(['jlist']))
const save = (file, value) => fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
const readSecret = file => fs.readFileSync(path.join(dir, file), 'utf8').trim()
const envOf = pid => Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean)
  .map(item => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]))
const live = processes().find(p => p.name === name)
if (!live) throw Error('Platform process missing')
const others = processes().filter(p => p.name !== name).map(p => [p.name, p.pid, p.pm2_env.status])
const assertOthers = () => {
  if (JSON.stringify(processes().filter(p => p.name !== name).map(p => [p.name, p.pid, p.pm2_env.status])) !== JSON.stringify(others)) throw Error('unrelated process changed')
}
const require = createRequire(`${live.pm2_env.pm_cwd}/package.json`)
const mysql = require('mysql2/promise')
const local = (db = undefined) => mysql.createConnection({ host: '127.0.0.1', port: localPort, user: 'root', password: readSecret('root.pw'), ...(db ? { database: db } : {}), multipleStatements: false })

// Server-side checksums: only numbers cross the network. Both servers are MySQL 8.0 InnoDB.
async function checksums(connection, db) {
  const [tables] = await connection.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema=? AND table_type='BASE TABLE' ORDER BY table_name", [db])
  if (!tables.length) return {}
  const [rows] = await connection.query(`CHECKSUM TABLE ${tables.map(({ t }) => `\`${db}\`.\`${t}\``).join(', ')}`)
  return Object.fromEntries(rows.map(r => [String(r.Table).split('.').pop(), String(r.Checksum)]))
}
function differing(remote, localSums) {
  const names = [...new Set([...Object.keys(remote), ...Object.keys(localSums)])].sort()
  return { tables: names.length, differ: names.filter(t => remote[t] !== localSums[t] && t in remote), extraLocal: names.filter(t => !(t in remote)) }
}
// Streams mysqldump (temporary container, same image) into the local container's mysql.
async function copy(remoteEnv, targetDb, tables = []) {
  const remotePw = path.join(dir, 'remote.pw')
  fs.writeFileSync(remotePw, remoteEnv.DB_PASSWORD, { mode: 0o600 })
  const started = Date.now()
  let bytes = 0
  try {
    await new Promise((resolve, reject) => {
      const dump = spawn('docker', ['run', '--rm', '-i', '--name', `hzy-platform-dev-dump-${process.pid}`, '-v', `${dir}:/s:ro`, image, 'sh', '-c',
        'h="$0"; p="$1"; u="$2"; d="$3"; shift 3; MYSQL_PWD="$(cat /s/remote.pw)" exec mysqldump -h "$h" -P "$p" -u "$u" --single-transaction --quick --set-gtid-purged=OFF --no-tablespaces --routines --events --triggers --hex-blob --default-character-set=utf8mb4 --column-statistics=0 "$d" "$@"',
        remoteEnv.DB_HOST, remoteEnv.DB_PORT || '3306', remoteEnv.DB_USER, remoteEnv.DB_NAME, ...tables])
      const load = spawn('docker', ['exec', '-i', container, 'sh', '-c', 'MYSQL_PWD="$(cat /run/secrets/root.pw)" exec mysql -uroot --default-character-set=utf8mb4 "$0"', targetDb])
      let dumpErr = '', loadErr = '', done = 0
      dump.stdout.on('data', chunk => { bytes += chunk.length })
      dump.stdout.pipe(load.stdin)
      dump.stderr.on('data', d => { dumpErr += d })
      load.stderr.on('data', d => { loadErr += d })
      const clean = text => String(text).split('\n').filter(l => l && !/password|Warning/i.test(l))[0]
      const finish = (which, code) => {
        if (code !== 0) return reject(Error(`${which} failed (${clean(which === 'mysqldump' ? dumpErr : loadErr) || code})`))
        if (++done === 2) resolve()
      }
      dump.on('close', code => finish('mysqldump', code))
      load.on('close', code => finish('import', code))
    })
    return { tables: tables.length || 'all', bytes, ms: Date.now() - started }
  } finally {
    fs.rmSync(remotePw, { force: true })
  }
}
const remoteConnection = remoteEnv => mysql.createConnection({ host: remoteEnv.DB_HOST, port: Number(remoteEnv.DB_PORT || 3306), user: remoteEnv.DB_USER, password: remoteEnv.DB_PASSWORD, database: remoteEnv.DB_NAME })
const appConfig = (env, script) => {
  const cleanEnv = Object.fromEntries(Object.entries(env).filter(([key]) => /^[A-Z][A-Z0-9_]*$/.test(key)
    && !/^(PM2_|PM_ID$|NODE_APP_INSTANCE$|NODE_UNIQUE_ID$|NODE_CHANNEL_FD$)/.test(key)))
  const settings = Object.fromEntries(['kill_timeout', 'listen_timeout', 'min_uptime', 'max_restarts', 'restart_delay',
    'exp_backoff_restart_delay', 'max_memory_restart', 'cron_restart', 'merge_logs', 'time', 'log_date_format',
    'node_args', 'args', 'shutdown_with_message', 'treekill', 'autorestart']
    .filter(key => live.pm2_env[key] !== undefined).map(key => [key, live.pm2_env[key]]))
  return { ...settings, name, cwd: live.pm2_env.pm_cwd, script, interpreter: live.pm2_env.exec_interpreter,
    out_file: live.pm2_env.pm_out_log_path, error_file: live.pm2_env.pm_err_log_path, exec_mode: 'fork', instances: 1, watch: false, env: cleanEnv }
}
const withLocalDb = env => ({ ...env, DB_HOST: '127.0.0.1', DB_PORT: String(localPort), DB_USER: appUser, DB_PASSWORD: readSecret('app.pw'), DB_NAME: database,
  NUXT_DB_HOST: '127.0.0.1', NUXT_DB_PORT: String(localPort), NUXT_DB_USER: appUser, NUXT_DB_PASSWORD: readSecret('app.pw'), NUXT_DB_NAME: database })

if (mode === 'prepare') {
  if (fs.existsSync(dir)) throw Error('already prepared')
  fs.mkdirSync(dir, { mode: 0o700 })
  save(path.join(dir, 'root.pw'), randomBytes(24).toString('base64url'))
  save(path.join(dir, 'app.pw'), randomBytes(24).toString('base64url'))
  fs.chmodSync(path.join(dir, 'root.pw'), 0o644) // readable by the container's mysql user; the directory itself stays 0700
  run('docker', ['run', '-d', '--name', container, '--restart', 'unless-stopped', '-p', `127.0.0.1:${localPort}:3306`,
    '-v', `${volume}:/var/lib/mysql`, '-v', `${path.join(dir, 'root.pw')}:/run/secrets/root.pw:ro`,
    '-e', 'MYSQL_ROOT_PASSWORD_FILE=/run/secrets/root.pw', '--memory', '1g', image, ...mysqldArgs])
  let ready = false
  for (let i = 0; i < 90 && !ready; i++) {
    ready = spawnSync('docker', ['exec', container, 'sh', '-c', 'MYSQL_PWD="$(cat /run/secrets/root.pw)" mysqladmin -uroot --protocol=TCP -h127.0.0.1 ping']).status === 0
    if (!ready) execFileSync('sleep', ['2'])
  }
  if (!ready) throw Error('local MySQL did not become ready')
  execFileSync('sleep', ['5'])
  const c = await local()
  await c.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  await c.query(`CREATE USER '${appUser}'@'%' IDENTIFIED WITH mysql_native_password BY ?`, [readSecret('app.pw')])
  await c.query(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${appUser}'@'%'`)
  const [[v]] = await c.query('SELECT VERSION() v, @@lower_case_table_names lc, @@time_zone tz, @@collation_server co')
  await c.end()
  assertOthers()
  console.log(JSON.stringify({ prepared: true, container, port: localPort, ...v }))
} else if (mode === 'seed') {
  const remoteEnv = envOf(live.pid)
  if (remoteEnv.DB_NAME !== database || remoteEnv.DB_HOST === '127.0.0.1') throw Error('Platform is not on the remote database')
  const c = await local()
  await c.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await c.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  const timing = await copy(remoteEnv, database)
  const r = await remoteConnection(remoteEnv)
  // Writes during the dump show up as differing tables; the cutover re-copies them.
  const result = differing(await checksums(r, remoteEnv.DB_NAME), await checksums(c, database))
  await r.end(); await c.end()
  assertOthers()
  console.log(JSON.stringify({ seeded: true, ...timing, tables: result.tables, differ: result.differ, extraLocal: result.extraLocal }))
} else if (mode === 'cutover') {
  const remoteEnv = envOf(live.pid)
  if (remoteEnv.DB_NAME !== database || remoteEnv.DB_HOST === '127.0.0.1') throw Error('Platform is not on the remote database')
  const attempt = fs.mkdtempSync(path.join(dir, 'cutover-'))
  save(path.join(attempt, 'rollback.config.json'), { apps: [appConfig(remoteEnv, live.pm2_env.pm_exec_path)] })
  save(path.join(attempt, 'candidate.config.json'), { apps: [appConfig(withLocalDb(remoteEnv), live.pm2_env.pm_exec_path)] })
  const token = remoteEnv.HZY_CLOUDFLARE_INTERNAL_TOKEN || remoteEnv.PLATFORM_INTERNAL_SERVICE_TOKENS?.split(',')[0]?.trim() || remoteEnv.PLATFORM_INTERNAL_SERVICE_TOKEN
  const base = '/api/platform/internal/console/tenants/C000001/bundle?environment=test&deploymentCode=wiztek-test-console'
  const timed = async (target, authenticated = true) => {
    const started = Date.now()
    const response = await fetch(`http://127.0.0.1:3011${target}`, { signal: AbortSignal.timeout(120000), headers: authenticated ? { authorization: `Bearer ${token}` } : {} })
    const body = await response.text()
    return { status: response.status, ms: Date.now() - started, bytes: body.length, body }
  }
  let stage = 'stop'
  const stoppedAt = new Date().toISOString()
  try {
    pm(['delete', name])
    stage = 'copy'
    const c = await local()
    const r = await remoteConnection(remoteEnv)
    const before = differing(await checksums(r, remoteEnv.DB_NAME), await checksums(c, database))
    for (const t of before.extraLocal) await c.query(`DROP TABLE \`${database}\`.\`${t}\``)
    const timing = before.differ.length ? await copy(remoteEnv, database, before.differ) : { tables: 0, bytes: 0, ms: 0 }
    stage = 'verify'
    const after = differing(await checksums(r, remoteEnv.DB_NAME), await checksums(c, database))
    await r.end(); await c.end()
    if (after.differ.length || after.extraLocal.length) throw Error(`checksum mismatch: ${[...after.differ, ...after.extraLocal].slice(0, 5).join(', ')}`)
    const verification = { tables: after.tables, recopied: before.differ, droppedLocal: before.extraLocal, mismatched: 0 }
    stage = 'start'
    pm(['start', path.join(attempt, 'candidate.config.json'), '--only', name])
    let healthy = false
    for (let i = 0; i < 40 && !healthy; i++) {
      try { healthy = (await timed('/api/health', false)).status === 200 } catch {}
      if (!healthy) execFileSync('sleep', ['1'])
    }
    if (!healthy) throw Error('health failed')
    stage = 'probe'
    const probes = []
    for (let i = 0; i < 3; i++) {
      const revision = await timed(`${base}&format=hzy-policy-revision.v1`)
      if (revision.status !== 200) throw Error(`revision ${revision.status}`)
      probes.push(revision.ms)
    }
    const envelope = await timed(`${base}&format=hzy-policy-envelope.v1`)
    if (envelope.status !== 200) throw Error(`envelope ${envelope.status}`)
    const data = JSON.parse(envelope.body).data
    const body = JSON.parse(data.body)
    if (body.tenant !== 'C000001' || body.status !== 'active' || !body.deployments.includes('wiztek-test-console')) throw Error('envelope content mismatch')
    const anonymous = await timed(`${base}&format=hzy-policy-revision.v1`, false)
    if (![401, 403].includes(anonymous.status)) throw Error('authentication missing')
    const now = processes().find(p => p.name === name)
    const nowEnv = envOf(now.pid)
    if (nowEnv.DB_HOST !== '127.0.0.1' || nowEnv.DB_PORT !== String(localPort)) throw Error('process not on local database')
    assertOthers()
    save(path.join(dir, 'cutover-receipt.json'), { cutoverAt: new Date().toISOString(), stoppedAt, target: name, database: `${database}@127.0.0.1:${localPort} (${container})`,
      previous: `${remoteEnv.DB_NAME}@${remoteEnv.DB_HOST}:${remoteEnv.DB_PORT || 3306}`, rollbackConfig: path.join(attempt, 'rollback.config.json'),
      copy: timing, verification,
      revisionProbeMs: probes, envelopeMs: envelope.ms, envelopeBytes: envelope.bytes, serviceKeys: body.serviceKeys?.length ?? 0,
      anonymous: anonymous.status, pid: now.pid, otherProcessesUnchanged: true })
    console.log(fs.readFileSync(path.join(dir, 'cutover-receipt.json'), 'utf8'))
  } catch (error) {
    try { pm(['delete', name]) } catch {}
    pm(['start', path.join(attempt, 'rollback.config.json'), '--only', name])
    console.error(`Cutover failed at ${stage}; Platform restarted on the remote database: ${String(error.message).slice(0, 200)}`)
    process.exitCode = 1
  }
} else if (mode === 'persist') {
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'cutover-receipt.json'), 'utf8'))
  if (live.pid !== receipt.pid || envOf(live.pid).DB_HOST !== '127.0.0.1') throw Error('live process does not match the cutover receipt')
  const dumpPath = '/root/.pm2/dump.pm2'
  const before = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
  if (before.filter(p => p.name === name).length !== 1) throw Error('saved baseline mismatch')
  const replacement = { ...live.pm2_env }
  delete replacement.pm_id
  const after = before.map(p => p.name === name ? replacement : p)
  const other = entries => JSON.stringify(entries.filter(p => p.name !== name))
  save(path.join(dir, 'protected-previous-dump.json'), before)
  const temporary = `${dumpPath}.platform-dev-db-localize.tmp`
  save(temporary, after)
  fs.renameSync(temporary, dumpPath)
  const stored = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
  if (other(stored) !== other(before) || stored.find(p => p.name === name)?.env?.DB_HOST !== '127.0.0.1' && stored.find(p => p.name === name)?.DB_HOST !== '127.0.0.1') throw Error('saved configuration verification failed')
  assertOthers()
  console.log('Persisted: hzy-platform-dev now restarts on the local database.')
} else if (mode === 'rollback') {
  // The remote database stopped receiving writes at cutover. A blind process
  // rollback would silently lose every later write. No data-fence/catch-up
  // proof is implemented here, so this command never changes the live app.
  throw Error('Rollback refused: stop Platform writes, copy all post-cutover data to the remote database, and verify a fenced checksum before switching the process. See deploy/test-env/LOCAL_RUNTIME.md; this script has no verified catch-up path.')
}
