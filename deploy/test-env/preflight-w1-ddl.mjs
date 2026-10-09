import { lstat, open } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { inspectDiskSpace } from './preflight-disk-space.mjs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const W1_DATABASE = 'hzy_enterprise_shadow_review_20260913'
export const W1_ALTER_TABLES = Object.freeze([
  'finance_account_balance_snapshot', 'finance_bank_account',
  'altoc_customer', 'altoc_contact', 'altoc_contract'
])
// Derive ledger names from the canonical installer declaration, not a second namespace.
const W1_TABLE_DECLARATIONS = JSON.parse(readFileSync(new URL('../../data-runtime/internal/enterprise/domaininstall/w1_tables.json', import.meta.url), 'utf8'))
const NEW_TABLES = [...new Set(Object.values(W1_TABLE_DECLARATIONS).flatMap(tables => tables.map(table => table.Physical)))]
export const W1_DDL_REQUIREMENTS = Object.freeze([
  ...['SELECT', 'SHOW VIEW'].map(privilege => ({ table: '*', privilege })),
  ...W1_ALTER_TABLES.map(table => ({ table, privilege: 'ALTER' })),
  ...['finance_bank_account', 'altoc_customer', 'altoc_contract'].map(table => ({ table, privilege: 'INDEX' })),
  ...['finance_bank_account', 'altoc_customer', 'altoc_contact', 'altoc_contract'].map(table => ({ table, privilege: 'REFERENCES' })),
  ...NEW_TABLES.flatMap(table => ['CREATE', 'DROP', 'SELECT'].map(privilege => ({ table, privilege })))
])

// Native MySQL privilege metadata; this is a readiness check, never an authorization grant.
// Active roles are deliberately unsupported rather than guessing their inherited privileges.
export async function inspectW1DdlPermissions(db) {
  const [identity] = await db.query('SELECT CURRENT_USER() AS account, CURRENT_ROLE() AS roles')
  if (identity.length !== 1 || identity[0].account !== 'hzy_apf_migration@127.0.0.1') throw new Error('w1_preflight_account_mismatch')
  if (identity[0].roles !== 'NONE') throw new Error('w1_preflight_active_roles_unsupported')
  const grantee = "'hzy_apf_migration'@'127.0.0.1'"
  const [global] = await db.execute('SELECT PRIVILEGE_TYPE AS privilege FROM information_schema.USER_PRIVILEGES WHERE GRANTEE=?', [grantee])
  const [schema] = await db.execute('SELECT PRIVILEGE_TYPE AS privilege FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE=? AND TABLE_SCHEMA=?', [grantee, W1_DATABASE])
  const [tables] = await db.execute('SELECT TABLE_NAME AS tableName, PRIVILEGE_TYPE AS privilege FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=? AND TABLE_SCHEMA=?', [grantee, W1_DATABASE])
  const broad = new Set([...global, ...schema].map(row => row.privilege))
  const table = new Set(tables.map(row => `${row.tableName}:${row.privilege}`))
  const missing = W1_DDL_REQUIREMENTS.filter(row => !broad.has(row.privilege) && !table.has(`${row.table}:${row.privilege}`))
  return { account: identity[0].account, database: W1_DATABASE, ready: missing.length === 0, missing }
}

async function readConfig(path) {
  if (!isAbsolute(path)) throw new Error('w1_preflight_config_invalid')
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.size > 65536) throw new Error('w1_preflight_config_invalid')
  const { constants } = await import('node:fs')
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const current = await fd.stat()
    if (current.ino !== stat.ino || current.dev !== stat.dev || current.size !== stat.size || (current.mode & 0o777) !== 0o600) throw new Error('w1_preflight_config_invalid')
    const config = JSON.parse(await fd.readFile('utf8'))
    if (config.host !== '127.0.0.1' || ![3306, 3320].includes(config.port) || config.database !== W1_DATABASE || config.user !== 'hzy_apf_migration' || typeof config.password !== 'string' || !config.password) throw new Error('w1_preflight_config_invalid')
    return config
  } finally { await fd.close() }
}

export async function inspectMigrationReadiness(db, inspectProfile, diskCheck = () => inspectDiskSpace(process.cwd())) {
  let ddl
  try { ddl = await inspectW1DdlPermissions(db) }
  catch { ddl = { ready: false, code: 'w1_ddl_not_ready' } }
  // A missing DDL privilege must not hide profile identity failures, or vice versa.
  let identities
  try { identities = await inspectProfile() }
  catch { identities = { ready: false, checks: [{ name: 'profile', ready: false, code: 'profile_preflight_failed' }] } }
  let disk
  try { disk = await diskCheck() }
  catch { disk = { ready: false, code: 'disk_space_check_failed' } }
  return { ready: ddl.ready && identities.ready && disk.ready, ddl, identities, disk }
}

export async function run(args) {
  if (![2, 8, 10].includes(args.length) || args[0] !== '--migration-db-config') throw new Error('w1_preflight_arguments_invalid')
  const full = args.length >= 8
  const phase = args.length === 10 ? args[9] : 'migration'
  if (args.length === 10 && (args[8] !== '--phase' || !['w1', 'migration'].includes(phase))) throw new Error('w1_preflight_arguments_invalid')
  if (full && (args[2] !== '--wizbiz-profile' || args[4] !== '--snapshot-manifest' || args[6] !== '--preflight-bin' || !args.slice(3, 8).filter((_, i) => i % 2 === 0).every(isAbsolute))) throw new Error('w1_preflight_arguments_invalid')
  const config = await readConfig(args[1])
  const mysql = createRequire(new URL('../../console/package.json', import.meta.url))('mysql2/promise')
  let db
  try {
    db = await mysql.createConnection({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password, multipleStatements: false, connectTimeout: 5000 })
  } catch {
    if (!full) throw new Error('w1_preflight_connection_failed')
    db = { query: async () => { throw new Error('w1_preflight_connection_failed') }, end: async () => {} }
  }
  try {
    const result = full ? await inspectMigrationReadiness(db, async () => {
      let stdout
      try { ({ stdout } = await promisify(execFile)(args[7], ['--profile', args[3], '--snapshot-manifest', args[5], '--phase', phase], { timeout: 450000, maxBuffer: 65536 })) }
      catch (error) { stdout = error.stdout }
      const value = JSON.parse(stdout)
      const required = name => phase === 'migration' || ['profile', 'runtime_binding', 'source', 'source_metadata'].includes(name)
      const names = ['profile', 'runtime_binding', 'runtime_build', 'source', 'source_metadata', 'target', 'dependencies', 'directory', 'vault']
      if (value.checks?.length !== names.length || value.checks.some((c, i) => c.name !== names[i] || typeof c.ready !== 'boolean' || c.required !== required(c.name) || c.code !== (!c.required ? 'not_required' : c.ready ? 'ok' : `${c.name}_not_ready`)) || value.phase !== phase || value.ready !== value.checks.every(c => !c.required || c.ready)) throw new Error('profile_preflight_invalid_output')
      // Do not forward arbitrary subprocess properties or raw stderr/driver text.
      return { phase, ready: value.ready, checks: value.checks.map(({ name, required, ready, code }) => ({ name, required, ready, code })) }
    }, () => inspectDiskSpace(dirname(args[1]))) : await (async () => {
      const ddl = await inspectW1DdlPermissions(db)
      const disk = await inspectDiskSpace(dirname(args[1]))
      return { ...ddl, ready: ddl.ready && disk.ready, disk }
    })()
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return result.ready ? 0 : 1
  } finally { await db.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then(code => { process.exitCode = code }).catch(() => {
    // Never surface driver text, connection strings or configuration values.
    process.stderr.write('w1_preflight_failed\n')
    process.exitCode = 1
  })
}
