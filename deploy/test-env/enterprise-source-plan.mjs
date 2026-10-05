#!/usr/bin/env node
// Only the existing migration CLI's default read-only plan mode is exposed.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execute = promisify(execFile)
const root = resolve(import.meta.dirname, '../..')
const output = resolve(process.argv[2] || join(root, 'deploy/test-env/artifacts/C000001.enterprise-migration-plan.json'))
let temporary
try {
 const runtime = JSON.parse(await readFile(resolve(homedir(), 'Library/Application Support/HuizhiYun/test-runtime/config.json'), 'utf8'))
 const frozen = JSON.parse(await readFile(join(root, 'deploy/test-env/artifacts/C000001.enterprise-migration-plan.json'), 'utf8'))
 const source = runtime.apps.aims.db
 if (runtime.tenant !== 'C000001' || runtime.deployment !== frozen.Config.RuntimeDeployment || !['localhost', '127.0.0.1'].includes(source.host)
  || source.database !== frozen.Config.SourceAims || runtime.apps.assets.db.database !== frozen.Config.SourceAssets
  || source.host !== runtime.apps.assets.db.host || source.port !== runtime.apps.assets.db.port) throw Error('Source binding mismatch')
 temporary = await mkdtemp(join(tmpdir(), 'hzy-readonly-enterprise-'))
 const configPath = join(temporary, 'config.json')
 await writeFile(configPath, JSON.stringify({ Migration: frozen.Config, Connection: { Host: source.host, Port: source.port, User: source.user, Password: source.password } }), { mode: 0o600 })
 const result = await execute('go', ['run', './cmd/hzy-enterprise-migrate', '--config', configPath, '--plan', output], { cwd: join(root, 'data-runtime'), timeout: 300000 })
 // CLI plan mode emits only counts and review identity, never the connection.
 const summary = result.stdout.split('\n').find(line => line.startsWith('mode=dry-run '))
 if (!summary) throw Error('Unexpected plan output')
 console.log(summary)
} catch {
 console.error('Read-only source plan failed; credential-bearing diagnostics suppressed.')
 process.exitCode = 1
} finally { if (temporary) await rm(temporary, { recursive: true, force: true }) }
