// S4 A12: one surgical restart of PM2 `hzy-platform-dev` that (1) sets CREDENTIALS_DIRECTORY for the protected
// drain-approval HMAC file and (2) appends two internal service tokens (Console, Gateway) to PLATFORM_INTERNAL_SERVICE_TOKENS.
// Modes: prepare | switch | probe | rollback | persist. Same build (cwd/entry unchanged); only the process environment changes.
// Secrets are never printed: only counts, lengths and truncated sha256 fingerprints.
const fs = require('fs'), crypto = require('crypto'), cp = require('child_process')
const name = 'hzy-platform-dev'
const HOST = 'iZcqwiqyhp9u8rZ'
const BUILD_CWD = '/wiztek/hzy-test/platform-release-54e54837/platform'
const CRED_DIR = '/root/hzy-drain-cred/active'
const TOKEN_FILES = { console: '/root/hzy-g9/a12/tok-console', gateway: '/root/hzy-g9/a12/tok-gateway' }
const root = '/wiztek/hzy-test/platform-candidates/a12-drain-cred-tokens'
const stateFile = root + '/switch-state.json'
const KID = 'psk_20260718_AElQdK3VQSja'
const pm = args => cp.execFileSync('pm2', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const list = () => JSON.parse(pm(['jlist']))
const write = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2), { mode: 0o600, flag: 'wx' })
const fp = s => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12)
const mode = process.argv[2]
if (!['prepare', 'switch', 'probe', 'rollback', 'persist'].includes(mode)) throw Error('mode')
if (cp.execFileSync('hostname', { encoding: 'utf8' }).trim() !== HOST) throw Error('host')
const live = list().find(x => x.name === name)
if (!live?.pid) throw Error('target offline')
const others = () => list().filter(x => x.name !== name).map(x => ({ name: x.name, pid: x.pid, status: x.pm2_env.status }))
const settings = x => Object.fromEntries(['kill_timeout', 'listen_timeout', 'min_uptime', 'max_restarts', 'restart_delay', 'exp_backoff_restart_delay', 'max_memory_restart', 'cron_restart', 'merge_logs', 'time', 'log_date_format'].filter(k => x.pm2_env[k] !== undefined && x.pm2_env[k] !== null).map(k => [k, x.pm2_env[k]]))
const procEnv = pid => Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map(x => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]))
const csv = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean)
const health = async () => { for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:3011/api/health', { signal: AbortSignal.timeout(3000) }); await r.body?.cancel(); if (r.status === 200) return true } catch {} await new Promise(r => setTimeout(r, 1000)) } return false }
const start = p => pm(['start', p, '--only', name])
const tokenStatus = async token => { const r = await fetch(`http://127.0.0.1:3011/api/platform/internal/signing-keys/${KID}`, { headers: { 'x-hzy-internal-token': token }, signal: AbortSignal.timeout(5000) }); const body = await r.text(); return { status: r.status, leaked: body.includes(token) } }
;(async () => {
  if (mode === 'prepare') {
    if (live.pm2_env.pm_cwd !== BUILD_CWD) throw Error('baseline cwd')
    const e = procEnv(live.pid)
    if (e.DB_NAME !== 'hzy_platform_dev' || e.PORT !== '3011' || e.NODE_ENV !== 'production') throw Error('binding')
    if (e.CREDENTIALS_DIRECTORY) throw Error('CREDENTIALS_DIRECTORY already set')
    const dirStat = fs.lstatSync(CRED_DIR), keyPath = CRED_DIR + '/offline-drain-hmac', keyStat = fs.lstatSync(keyPath)
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink() || (dirStat.mode & 0o077) || dirStat.uid !== 0) throw Error('credential directory unprotected')
    if (!keyStat.isFile() || keyStat.isSymbolicLink() || (keyStat.mode & 0o077) || keyStat.uid !== 0 || keyStat.size !== 32) throw Error('hmac file unprotected or wrong length')
    const tokens = {}
    for (const [k, f] of Object.entries(TOKEN_FILES)) {
      const st = fs.lstatSync(f); if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) || st.uid !== 0) throw Error('token file unprotected: ' + k)
      tokens[k] = fs.readFileSync(f, 'utf8').trim(); if (!/^[0-9a-f]{64}$/.test(tokens[k])) throw Error('token format: ' + k)
    }
    const oldEntries = csv(e.PLATFORM_INTERNAL_SERVICE_TOKENS)
    if (!oldEntries.length) throw Error('no existing internal tokens')
    const all = [...oldEntries, tokens.console, tokens.gateway]
    if (new Set(all).size !== all.length) throw Error('token not distinct')
    const clean = Object.fromEntries(Object.entries(e).filter(([k]) => /^[A-Z][A-Z0-9_]*$/.test(k) && !/^(PM2_|PM_ID$|NODE_APP_INSTANCE$|NODE_UNIQUE_ID$|NODE_CHANNEL_FD$)/.test(k)))
    const app = { ...settings(live), name, cwd: live.pm2_env.pm_cwd, script: live.pm2_env.pm_exec_path, interpreter: live.pm2_env.exec_interpreter, out_file: live.pm2_env.pm_out_log_path, error_file: live.pm2_env.pm_err_log_path, exec_mode: 'fork', instances: 1, watch: false, env: clean }
    fs.mkdirSync(root, { mode: 0o700 })
    write(root + '/rollback.config.json', { apps: [app] })
    write(root + '/candidate.config.json', { apps: [{ ...app, env: { ...clean, CREDENTIALS_DIRECTORY: CRED_DIR, PLATFORM_INTERNAL_SERVICE_TOKENS: all.join(',') } }] })
    fs.copyFileSync('/root/.pm2/dump.pm2', root + '/protected-dump.pm2', fs.constants.COPYFILE_EXCL); fs.chmodSync(root + '/protected-dump.pm2', 0o600)
    write(stateFile, { oldEntryFps: oldEntries.map(fp), newFps: [fp(tokens.console), fp(tokens.gateway)], envKeyCount: Object.keys(clean).length, others: others(), preparedAt: new Date().toISOString() })
    console.log(JSON.stringify({ prepared: true, oldPid: live.pid, existingTokenEntries: oldEntries.length, existingFps: oldEntries.map(fp), newFps: [fp(tokens.console), fp(tokens.gateway)], hmacFileBytes: keyStat.size, credDirMode: (dirStat.mode & 0o777).toString(8), others: others() }))
    return
  }
  const s = JSON.parse(fs.readFileSync(stateFile))
  const verifyLive = () => {
    const n = list().find(x => x.name === name); const e = procEnv(n.pid); const entries = csv(e.PLATFORM_INTERNAL_SERVICE_TOKENS)
    const okEnv = e.CREDENTIALS_DIRECTORY === CRED_DIR && e.NODE_ENV === 'production' && e.DB_NAME === 'hzy_platform_dev' && e.PORT === '3011'
    const okTokens = entries.length === s.oldEntryFps.length + 2 && JSON.stringify(entries.slice(0, s.oldEntryFps.length).map(fp)) === JSON.stringify(s.oldEntryFps) && JSON.stringify(entries.slice(-2).map(fp)) === JSON.stringify(s.newFps)
    return { pid: n.pid, cwd: n.pm2_env.pm_cwd === BUILD_CWD, okEnv, okTokens, othersUnchanged: JSON.stringify(others()) === JSON.stringify(s.others), drainTokenSet: Boolean(e.HZY_DRAIN_CONTROL_TOKEN) }
  }
  if (mode === 'switch') {
    if (live.pm2_env.pm_cwd !== BUILD_CWD || JSON.stringify(others()) !== JSON.stringify(s.others)) throw Error('baseline drift')
    const started = Date.now()
    pm(['delete', name])
    try {
      start(root + '/candidate.config.json')
      if (!(await health())) throw Error('candidate health')
      const v = verifyLive(); if (!(v.cwd && v.okEnv && v.okTokens && v.othersUnchanged)) throw Error('verify ' + JSON.stringify(v))
      console.log(JSON.stringify({ switched: true, downtimeMs: Date.now() - started, ...v }))
    } catch (err) {
      try { pm(['delete', name]) } catch {}
      start(root + '/rollback.config.json')
      console.log(JSON.stringify({ switchFailed: String(err.message), autoRolledBack: await health(), downtimeMs: Date.now() - started }))
      process.exit(1)
    }
  } else if (mode === 'probe') {
    const e = procEnv(live.pid); const entries = csv(e.PLATFORM_INTERNAL_SERVICE_TOKENS)
    const res = []
    for (const t of entries) res.push({ fp: fp(t), ...(await tokenStatus(t)) })
    const bogus = await tokenStatus('0'.repeat(64))
    console.log(JSON.stringify({ probes: res, bogus: bogus.status }))
  } else if (mode === 'rollback') {
    pm(['delete', name]); start(root + '/rollback.config.json')
    if (!(await health())) throw Error('rollback health')
    const n = list().find(x => x.name === name); const e = procEnv(n.pid)
    console.log(JSON.stringify({ rolledBack: true, pid: n.pid, credDirUnset: !e.CREDENTIALS_DIRECTORY, tokenEntries: csv(e.PLATFORM_INTERNAL_SERVICE_TOKENS).length, othersUnchanged: JSON.stringify(others()) === JSON.stringify(s.others) }))
  } else {
    const v = verifyLive(); if (!(v.cwd && v.okEnv && v.okTokens && v.othersUnchanged)) throw Error('unverified switch')
    const dump = '/root/.pm2/dump.pm2', before = JSON.parse(fs.readFileSync(dump))
    if (before.filter(x => x.name === name).length !== 1 || JSON.stringify(before) !== JSON.stringify(JSON.parse(fs.readFileSync(root + '/protected-dump.pm2')))) throw Error('dump baseline')
    const repl = { ...list().find(x => x.name === name).pm2_env }; delete repl.pm_id
    if (repl.CREDENTIALS_DIRECTORY !== CRED_DIR || csv(repl.PLATFORM_INTERNAL_SERVICE_TOKENS).length !== s.oldEntryFps.length + 2) throw Error('live pm2_env lacks the new environment; dump not written')
    const after = before.map(x => x.name === name ? repl : x)
    const temp = dump + '.a12.tmp'; fs.writeFileSync(temp, JSON.stringify(after, null, 2), { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, dump)
    const check = JSON.parse(fs.readFileSync(dump)); const c = check.find(x => x.name === name)
    if (c.CREDENTIALS_DIRECTORY !== CRED_DIR || JSON.stringify(check.filter(x => x.name !== name)) !== JSON.stringify(before.filter(x => x.name !== name))) throw Error('dump verify')
    console.log(JSON.stringify({ persisted: true, pid: v.pid, othersUnchanged: true, dumpTokenEntries: csv(c.PLATFORM_INTERNAL_SERVICE_TOKENS).length }))
  }
})().catch(e => { console.error('a12 stage failed: ' + e.message); process.exit(1) })
