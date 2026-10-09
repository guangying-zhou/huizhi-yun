// Persist only the already-verified hzy-platform-dev entry in the PM2 dump.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const root = '/wiztek/hzy-test/platform-candidates/policy-lease-20260922'
const name = 'hzy-platform-dev'
const dumpPath = '/root/.pm2/dump.pm2'
if (execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw Error('host mismatch')
const receipt = JSON.parse(fs.readFileSync(`${root}/deployment-receipt.json`, 'utf8'))
const live = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' })).find(p => p.name === name)
if (live?.pid !== receipt.pid || live.pm2_env.pm_exec_path !== receipt.candidateEntry) throw Error('live deployment mismatch')
const before = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
if (before.filter(p => p.name === name).length !== 1) throw Error('saved process inventory mismatch')
const previous = before.find(p => p.name === name)
if (previous.pm_exec_path !== receipt.previousEntry) throw Error('saved baseline mismatch')
const replacement = { ...live.pm2_env }
delete replacement.pm_id
const after = before.map(p => p.name === name ? replacement : p)
const other = entries => JSON.stringify(entries.filter(p => p.name !== name))
if (other(before) !== other(after)) throw Error('unrelated saved process changed')
fs.writeFileSync(`${root}/protected-previous-dump.json`, JSON.stringify(before, null, 2), { flag: 'wx', mode: 0o600 })
const temporary = `${dumpPath}.policy-lease-20260922.tmp`
fs.writeFileSync(temporary, JSON.stringify(after, null, 2), { flag: 'wx', mode: 0o600 })
fs.renameSync(temporary, dumpPath)
const stored = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
if (other(stored) !== other(before) || stored.find(p => p.name === name)?.pm_exec_path !== receipt.candidateEntry) {
  throw Error('saved configuration verification failed')
}
fs.writeFileSync(`${root}/persistence-receipt.json`, JSON.stringify({ savedAt: new Date().toISOString(),
  target: name, entry: receipt.candidateEntry, previousEntry: receipt.previousEntry,
  otherProcessesUnchanged: true }, null, 2), { flag: 'wx', mode: 0o600 })
console.log('Verified Platform dev PM2 persistence for target only.')
