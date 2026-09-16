#!/usr/bin/env node
import process from 'node:process'
import {
  TemporaryMySqlConfigurationError,
  buildTemporaryMySqlPlan,
  withTemporaryMySql
} from './test/support/temporary-mysql-harness.mjs'

function usage() {
  return `Usage (safe preview; starts no process and creates no directory):
  pnpm run harness:mysql -- [--sql <console|aims|altoc|people>=<workspace-file.sql>]...

Execute only after reviewing the exact preview digest:
  pnpm run harness:mysql -- \
    --sql console=console/docs/hzy_console_schema.sql \
    --sql aims=aims/docs/aims_schema.sql \
    --sql altoc=altoc/docs/altoc_schema.sql \
    --execute --confirm <confirmation-sha256>

Binary selection is limited to --mysqld/--mysql, HZY_TEST_MYSQLD /
HZY_TEST_MYSQL, or PATH. The harness never reads .env, DB_*, MYSQL_*, passwords,
login paths, or existing MySQL option files. Every execution uses a fresh
datadir, creates hzy_console/hzy_aims/hzy_altoc/hzy_people, and runs each --sql file once
in input order. It does not claim that a schema is safe to import repeatedly.`
}

function optionValue(argv, index, raw) {
  const equals = raw.indexOf('=')
  if (equals >= 0) return { value: raw.slice(equals + 1), next: index }
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new TemporaryMySqlConfigurationError(`missing value for ${raw}`)
  return { value, next: index + 1 }
}

export function parseTemporaryMySqlArgs(argv) {
  const args = {
    execute: false,
    confirm: '',
    mysqld: '',
    mysql: '',
    sqlFiles: [],
    startupTimeoutMs: undefined,
    help: false
  }
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (raw === '--') continue
    if (raw === '--help' || raw === '-h') { args.help = true; continue }
    if (raw === '--execute') { args.execute = true; continue }
    if (!raw.startsWith('--')) throw new TemporaryMySqlConfigurationError(`unexpected argument: ${raw}`)
    const name = raw.slice(2).split('=', 1)[0]
    if (/(password|secret|token|credential|login-path|host|port|user|database)/i.test(name)) {
      throw new TemporaryMySqlConfigurationError(`--${name} is forbidden; the harness owns all connection state`)
    }
    const option = optionValue(argv, index, raw)
    index = option.next
    if (name === 'confirm') args.confirm = option.value
    else if (name === 'mysqld') args.mysqld = option.value
    else if (name === 'mysql') args.mysql = option.value
    else if (name === 'startup-timeout-ms') args.startupTimeoutMs = Number(option.value)
    else if (name === 'sql') {
      const separator = option.value.indexOf('=')
      if (separator <= 0 || separator === option.value.length - 1) {
        throw new TemporaryMySqlConfigurationError('--sql must be <console|aims|altoc|people>=<workspace-file.sql>')
      }
      args.sqlFiles.push({
        appCode: option.value.slice(0, separator),
        path: option.value.slice(separator + 1)
      })
    } else {
      throw new TemporaryMySqlConfigurationError(`unknown option: --${name}`)
    }
  }
  if (args.startupTimeoutMs !== undefined && (!Number.isInteger(args.startupTimeoutMs) || args.startupTimeoutMs < 500 || args.startupTimeoutMs > 60_000)) {
    throw new TemporaryMySqlConfigurationError('--startup-timeout-ms must be an integer from 500 to 60000')
  }
  return args
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseTemporaryMySqlArgs(argv)
  if (args.help) {
    console.info(usage())
    return 0
  }
  const plan = await buildTemporaryMySqlPlan({
    rootDir: process.cwd(),
    mysqld: args.mysqld || process.env.HZY_TEST_MYSQLD || 'mysqld',
    mysql: args.mysql || process.env.HZY_TEST_MYSQL || 'mysql',
    sqlFiles: args.sqlFiles
  })
  console.info(`[temporary-mysql] mode=${args.execute ? 'execute' : 'preview'} bind=127.0.0.1 port=random no-defaults=true`)
  console.info('[temporary-mysql] lifecycle=fresh-datadir; each SQL file runs exactly once in input order; repeat-import idempotency is not claimed')
  console.info(`[temporary-mysql] databases=${Object.entries(plan.databases).map(([app, database]) => `${app}:${database}`).join(',')}`)
  for (const [index, item] of plan.sqlFiles.entries()) {
    console.info(`[temporary-mysql] sql.${index + 1} app=${item.appCode} file=${item.path} sha256=${item.sha256}`)
  }
  console.info(`[temporary-mysql] confirmationSha256=${plan.confirmationSha256}`)
  if (!args.execute) {
    console.info('[temporary-mysql] preview complete; no directory, socket, port, or process was created.')
    return 0
  }
  await withTemporaryMySql(plan, async (context) => {
    console.info(`[temporary-mysql] ready serverMajor=${context.versions.mysqld.major} clientMajor=${context.versions.mysql.major} host=127.0.0.1 port=${context.port}`)
    console.info(`[temporary-mysql] appliedSqlFiles=${plan.sqlFiles.length}; credentials are intentionally not printed`)
  }, {
    execute: true,
    confirm: args.confirm,
    startupTimeoutMs: args.startupTimeoutMs
  })
  console.info('[temporary-mysql] complete; mysqld stopped and temporary directory removed.')
  return 0
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().then(
    code => { process.exitCode = code },
    error => {
      console.error(`[temporary-mysql] ${error.message}`)
      process.exitCode = 1
    }
  )
}
