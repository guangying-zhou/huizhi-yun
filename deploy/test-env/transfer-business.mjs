// The Mac relays only encrypted bytes. No production plaintext or private keys land here.
import fs from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { businessTables, preservedTables, refreshId } from './data-refresh-plan.mjs'

if (process.argv[2] !== '--execute') throw new Error('Requires --execute')
const root = `/wiztek/hzy-test/backups/${refreshId}`
const publicKey = execFileSync('ssh', ['-o', 'BatchMode=yes', 'root@gitlab.wiztek.cn', `head -c 4096 ${root}/public.pem`], { encoding: 'utf8' })
if (!publicKey.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('Missing target public key')
for (const app of ['console', 'people']) {
  const input = { app, tables: businessTables[app], knownTables: [...businessTables[app], ...preservedTables[app]], publicKey }
  const source = spawn('ssh', ['-o', 'BatchMode=yes', 'root@oa.wiztek.cn', 'node --input-type=module'], { stdio: ['pipe', 'pipe', 'pipe'] })
  const target = spawn('ssh', ['-o', 'BatchMode=yes', 'root@gitlab.wiztek.cn', `node /wiztek/hzy-test/refresh-business.mjs --receive ${app}`], { stdio: ['pipe', 'pipe', 'pipe'] })
  source.stderr.resume(); target.stderr.resume()
  const exited = child => new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error('Encrypted transfer failed; inspect protected state'))) })
  const completions = [exited(source), exited(target)]
  target.stdout.resume()
  source.stdin.end(`const refreshInput = ${JSON.stringify(input)};\n${fs.readFileSync(new URL('./export-business.mjs', import.meta.url), 'utf8')}`)
  await Promise.all([...completions, pipeline(source.stdout, target.stdin)])
  console.log(`${app}: encrypted snapshot transferred; plaintext never written on Mac.`)
}
