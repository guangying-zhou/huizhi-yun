#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'

function read(path) {
  if (!existsSync(path)) throw new Error(`required file is missing: ${path}`)
  return readFileSync(path, 'utf8')
}

function requireIncludes(content, needle, label) {
  if (!content.includes(needle)) throw new Error(`${label} must include ${JSON.stringify(needle)}`)
}

function forbidIncludes(content, needle, label) {
  if (content.includes(needle)) throw new Error(`${label} must not include stale text ${JSON.stringify(needle)}`)
}

function main() {
  const rootPackage = JSON.parse(read('package.json'))
  const consolePackage = JSON.parse(read('console/package.json'))
  const consoleReadme = read('console/README.md')
  const consoleClaude = read('console/CLAUDE.md')
  const cloudflareReadme = read('console/deploy/cloudflare/README.md')
  const migrationPlan = read('console/docs/Console-Database-Split-and-Data-Runtime-Migration-Task-List.md')
  const cutover = read('console/docs/Console-Tenant-Runtime-Wiztek-Cutover-Runbook.md')
  const acceptScript = read('scripts/accept-runtime-isolation.mjs')

  for (const name of [
    'audit:console-db-boundary',
    'verify:console-zero-db-cutover',
    'validate:console-cloudflare',
    'accept:runtime-isolation'
  ]) {
    if (!rootPackage.scripts?.[name]) throw new Error(`package.json must define script ${name}`)
  }
  if (consolePackage.dependencies?.mysql2 || consolePackage.devDependencies?.mysql2) {
    throw new Error('console/package.json must not depend on mysql2')
  }

  requireIncludes(consoleReadme, '默认端口为 `3000`', 'console/README.md')
  requireIncludes(consoleReadme, 'Tenant Runtime', 'console/README.md')
  requireIncludes(consoleReadme, 'pnpm run verify:console-zero-db-cutover', 'console/README.md')
  forbidIncludes(consoleReadme, 'verify:console-runtime-cache', 'console/README.md')

  requireIncludes(consoleClaude, 'Console 进程不得接收 `DB_*`', 'console/CLAUDE.md')
  requireIncludes(consoleClaude, '默认开发端口为 `3000`', 'console/CLAUDE.md')
  requireIncludes(cloudflareReadme, '不绑定 Hyperdrive', 'Cloudflare README')
  requireIncludes(cloudflareReadme, 'HZY_PLATFORM_BUNDLE_CACHE_BACKEND=memory', 'Cloudflare README')
  forbidIncludes(cloudflareReadme, 'hyperdrive create', 'Cloudflare README')

  requireIncludes(migrationPlan, '0 个 DB 文件、0 个调用点', 'migration plan')
  requireIncludes(migrationPlan, 'Wiztek 生产落地任务', 'migration plan')
  requireIncludes(cutover, 'ACL 撤销', 'cutover runbook')
  requireIncludes(cutover, '不允许把 DB 配置重新写回 Console', 'cutover runbook')

  requireIncludes(acceptScript, 'scripts/verify-console-zero-db-cutover.mjs', 'accept-runtime-isolation.mjs')
  forbidIncludes(acceptScript, 'scripts/verify-console-runtime-cache.mjs', 'accept-runtime-isolation.mjs')
  forbidIncludes(acceptScript, 'scripts/validate-console-runtime-cache-guardrails.mjs', 'accept-runtime-isolation.mjs')

  console.info('[runtime-isolation-docs] passed')
}

try {
  main()
} catch (error) {
  console.error(`[runtime-isolation-docs] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
