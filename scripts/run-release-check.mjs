#!/usr/bin/env node
import { resolve } from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const WORKSPACE_ROOT = resolve(import.meta.dirname, '..')
const EXPECTED_NODE = 'v24.18.0'
const EXPECTED_PNPM = '11.17.0'
const allowDirty = process.argv.includes('--allow-dirty')
const allowIncompleteReleasePlan = process.argv.includes('--allow-incomplete-release-plan')
const affectedOnly = process.argv.includes('--affected')
const skipGoToolchain = affectedOnly && process.env.HZY_CI_SKIP_GO === '1'
const knownArguments = new Set(['--allow-dirty', '--allow-incomplete-release-plan', '--affected', '--'])
const unknownArgs = process.argv.slice(2).filter(argument => !knownArguments.has(argument))

function fail(message) {
  console.error(`[release:check] ${message}`)
  process.exit(1)
}

function capture(command, args, cwd = WORKSPACE_ROOT) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.error) fail(`${command} could not start: ${result.error.message}`)
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed${result.stderr ? `: ${result.stderr.trim()}` : ''}`)
  }
  return result.stdout.trim()
}

function run(label, command, args, cwd = WORKSPACE_ROOT) {
  console.info(`\n[release:check] ${label}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) fail(`${label} could not start: ${result.error.message}`)
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status ?? 'unknown'}`)
}

if (unknownArgs.length > 0) fail(`unknown arguments: ${unknownArgs.join(', ')}`)

const nodeVersion = process.version
const pnpmVersion = capture('corepack', ['pnpm', '--version'])
const goVersion = skipGoToolchain ? 'go toolchain skipped (no Go module changed)' : capture('go', ['version'])
if (nodeVersion !== EXPECTED_NODE) fail(`Node ${EXPECTED_NODE} is required; current ${nodeVersion}`)
if (pnpmVersion !== EXPECTED_PNPM) {
  fail(`pnpm ${EXPECTED_PNPM} is required; current ${pnpmVersion}. Run through the repository's pinned Corepack/pnpm toolchain.`)
}

console.info(`[release:check] toolchain node=${nodeVersion} pnpm=${pnpmVersion} ${goVersion}`)

const repositories = [{ name: 'monorepo', path: WORKSPACE_ROOT }]

const dirtyRepositories = []
for (const repository of repositories) {
  const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repository.path)
  const revision = capture('git', ['rev-parse', '--short=12', 'HEAD'], repository.path)
  const status = capture('git', ['status', '--porcelain'], repository.path)
  const state = status ? 'dirty' : 'clean'
  console.info(`[release:check] repo=${repository.name} branch=${branch} revision=${revision} state=${state}`)
  if (status) dirtyRepositories.push(repository.name)

  run(`${repository.name}: unstaged whitespace check`, 'git', ['diff', '--check'], repository.path)
  run(`${repository.name}: staged whitespace check`, 'git', ['diff', '--cached', '--check'], repository.path)
}

if (dirtyRepositories.length > 0) {
  const message = `dirty repositories: ${dirtyRepositories.join(', ')}`
  if (!allowDirty) fail(`${message}. Commit/stash changes for a release, or use --allow-dirty for development-only verification.`)
  console.warn(`[release:check] WARNING development-only dirty run (${message})`)
}

run(
  'P3/P4 release contract',
  'node',
  [
    'scripts/validate-p3-p4-release-contract.mjs',
    ...(allowDirty ? ['--allow-dirty'] : []),
    ...(allowDirty || allowIncompleteReleasePlan ? ['--allow-incomplete'] : [])
  ]
)

run('P3/P4 release manifest discovery behavior', 'node', ['--test', 'scripts/test/p3-p4-release-manifest-discovery.test.mjs'])

const pnpmChecks = [
  ['monorepo history, tags and secret tracking', 'validate:monorepo-migration'],
  ['Cloudflare deployment command gates', 'validate:cloudflare-deploy-gates'],
  ['tracked environment policy', 'validate:env-tracking'],
  ['Platform Cloudflare default deployment', 'validate:platform-cloudflare-default'],
  ['Console Cloudflare configuration', 'validate:console-cloudflare'],
  ['business Worker Cloudflare configurations', 'validate:business-cloudflare'],
  ['Console Runtime schema manifest', 'validate:console-runtime-schema'],
  ['Console zero-DB cutover boundary', 'verify:console-zero-db-cutover'],
  ['runtime isolation documentation', 'validate:runtime-isolation-docs'],
  ['runtime probe guardrails', 'validate:runtime-probe-guardrails'],
  ['public routing plan', 'validate:public-routing-plan'],
  ['runtime isolation key fixture', 'validate:runtime-isolation:keys'],
  ['runtime/schema/API change contracts', 'validate:runtime-contract-changes'],
  ['business authorization implementation boundaries', 'validate:authorization-boundaries'],
  ['P3/P4 isolated demo data package', 'validate:p3-p4-demo-data'],
  ['P3/P4 demo verifier behavior', 'test:p3-p4-demo-data'],
  ['People G2-2 read acceptance behavior', 'test:people-g2-2-acceptance'],
  ['People runtime schema inventory', 'test:people-runtime-schema-contract'],
  ['G2-3 labor-cost loop acceptance behavior', 'test:g2-3-labor-cost-acceptance'],
  ['G2-6 offline release plan behavior', 'test:g2-6-release-plan'],
  ['Tenant Gateway guarded release behavior', 'test:tenant-gateway-release'],
  ['Temporary MySQL harness safety behavior', 'test:mysql-harness'],
  ['Local process-group supervisor safety behavior', 'test:process-group-harness'],
  ['G3 real HTTP harness static contract', 'test:g3-real-http-harness'],
  ['Data Runtime immutable package and R2 release behavior', 'test:data-runtime-release-chain'],
  ['Connector Runtime immutable package and R2 release behavior', 'test:connector-runtime-release-chain'],
  ['Tenant Gateway routing and context contracts', 'validate:tenant-gateway'],
  ...(!affectedOnly
    ? [
        ['active workspace lint', 'lint:active'],
        ['active workspace typecheck', 'typecheck:active'],
        ['active workspace tests', 'test:active']
      ]
    : [])
]

for (const [label, script] of pnpmChecks) run(label, 'corepack', ['pnpm', 'run', script])

run(
  'affected workspace selection behavior',
  'node',
  ['--test', 'scripts/test/affected-workspace-checks.test.mjs']
)

if (affectedOnly) {
  run('changed workspace and Go checks', 'node', ['scripts/run-affected-workspace-checks.mjs'])
} else {
  run('Data Runtime Go tests', 'go', ['test', './...'], resolve(WORKSPACE_ROOT, 'data-runtime'))
  run('Notification Runtime Go tests', 'go', ['test', './...'], resolve(WORKSPACE_ROOT, 'notification-runtime'))
  run('Dev Agent Go tests', 'go', ['test', './...'], resolve(WORKSPACE_ROOT, 'dev-agent'))
}

console.info('\n[release:check] passed; no deployment, live probe, acceptance, or secret-management command was executed')
