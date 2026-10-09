#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

import {
  affectedGoModules,
  affectedWorkspacePackageNames,
  isUsableDiffBase,
  requiresFullWorkspaceCheck
} from './lib/affected-checks.mjs'

const WORKSPACE_ROOT = resolve(import.meta.dirname, '..')
const ACTIVE_ACCOUNT_EXCLUSION = '!account'

function fail(message) {
  console.error(`[affected-checks] ${message}`)
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
  console.info(`\n[affected-checks] ${label}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) fail(`${label} could not start: ${result.error.message}`)
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status ?? 'unknown'}`)
}

function parseArguments(argv) {
  const args = [...argv]
  let base = process.env.HZY_CI_DIFF_BASE || ''

  while (args.length > 0) {
    const argument = args.shift()
    if (argument === '--base') {
      if (args.length === 0) fail('--base requires a Git revision')
      base = args.shift()
      continue
    }
    fail(`unknown argument: ${argument}`)
  }

  return { base }
}

function workspacePackages() {
  const manifests = capture('git', ['ls-files', '**/package.json'])
    .split('\n')
    .filter(Boolean)

  return manifests.map((manifest) => {
    const packageJson = JSON.parse(readFileSync(resolve(WORKSPACE_ROOT, manifest), 'utf8'))
    return {
      name: packageJson.name,
      path: manifest.slice(0, -'/package.json'.length)
    }
  }).filter(workspace => workspace.name)
}

function changedFilesSince(base) {
  if (!isUsableDiffBase(base)) {
    console.warn('[affected-checks] no usable diff base; falling back to the full active workspace check')
    return { changedFiles: ['.gitlab-ci.yml'], fallback: true }
  }

  const revisionExists = spawnSync('git', ['cat-file', '-e', `${base}^{commit}`], {
    cwd: WORKSPACE_ROOT,
    stdio: 'ignore'
  })
  if (revisionExists.status !== 0) {
    console.warn(`[affected-checks] diff base ${base} is unavailable; falling back to the full active workspace check`)
    return { changedFiles: ['.gitlab-ci.yml'], fallback: true }
  }

  const output = capture('git', ['diff', '--name-only', '--diff-filter=ACDMRTUXB', base, 'HEAD'])
  return { changedFiles: output.split('\n').filter(Boolean), fallback: false }
}

function runWorkspacePhase(phase, packageNames) {
  const filters = packageNames.flatMap(name => ['--filter', `...${name}`])
  run(
    `affected workspace ${phase}`,
    'corepack',
    ['pnpm', '-r', ...filters, '--filter', ACTIVE_ACCOUNT_EXCLUSION, '--if-present', phase]
  )
}

const { base } = parseArguments(process.argv.slice(2))
const { changedFiles, fallback } = changedFilesSince(base)
const fullWorkspaceCheck = fallback || requiresFullWorkspaceCheck(changedFiles)
const packageNames = affectedWorkspacePackageNames(changedFiles, workspacePackages())
const goModules = affectedGoModules(changedFiles, { forceFull: fallback })

console.info(`[affected-checks] base=${base || '(missing)'} head=${capture('git', ['rev-parse', '--short=12', 'HEAD'])}`)
console.info(`[affected-checks] changed files=${changedFiles.length} mode=${fullWorkspaceCheck ? 'full' : 'affected'}`)

if (fullWorkspaceCheck) {
  run('active workspace lint', 'corepack', ['pnpm', 'run', 'lint:active'])
  run('active workspace typecheck', 'corepack', ['pnpm', 'run', 'typecheck:active'])
  run('active workspace tests', 'corepack', ['pnpm', 'run', 'test:active'])
} else {
  run('workspace Nuxt version alignment', 'corepack', ['pnpm', 'run', 'test:workspace-nuxt-alignment'])
  run('workspace test-script policy', 'corepack', ['pnpm', 'run', 'validate:test-scripts'])

  if (packageNames.length > 0) {
    console.info(`[affected-checks] workspace seeds=${packageNames.join(', ')}`)
    runWorkspacePhase('lint', packageNames)
    runWorkspacePhase('typecheck', packageNames)
    runWorkspacePhase('test', packageNames)
  } else {
    console.info('[affected-checks] no active workspace package changed; lint/typecheck/module tests skipped')
  }
}

for (const moduleName of goModules) {
  run(`${moduleName} Go tests`, 'go', ['test', './...'], resolve(WORKSPACE_ROOT, moduleName))
}

if (goModules.length === 0) console.info('[affected-checks] no Go module changed; Go tests skipped')
console.info('\n[affected-checks] passed')
