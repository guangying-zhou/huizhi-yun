#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_DIRECTORY = resolve(WORKSPACE_ROOT, 'scripts/fixtures/runtime-contract-changes')
const SHARED_API_CONTRACT_DOCUMENTS = new Set([
  'data-runtime/README.md',
  'docs/MODULE_CONTRACTS.md',
  'docs/Tenant-Runtime-API-Contract-v1.md'
])

// Standalone migration code can span more than one business schema. Unknown
// migration scopes fail closed until their affected schema documents are mapped.
const MIGRATION_SCHEMA_DOCUMENTS = new Map([
  ['wizbiz', [
    { app: 'altoc', label: 'Altoc schema' },
    { app: 'finance', label: 'Finance schema' }
  ]]
])

function usage() {
  return `
Usage:
  node scripts/validate-runtime-contract-changes.mjs
  node scripts/validate-runtime-contract-changes.mjs --base <git-revision>
  node scripts/validate-runtime-contract-changes.mjs --changed-files-file <path>
  node scripts/validate-runtime-contract-changes.mjs --self-test

Local release/deploy preflight for changed-file associations only; it does not
execute Go tests.

Without a fixture, the monorepo comparison base is --base and defaults to HEAD.
All tracked and untracked module changes are read from that single Git worktree.
To supply a release manifest from another orchestrator, pass one
repository-relative path per line with --changed-files-file.

Rules:
  - data-runtime/internal/apps/<app> non-test Go changes require a changed Go
    test in the same app and a changed tenant-runtime API contract document.
  - data-runtime/internal/server non-test Go changes require a changed server
    Go test and a changed shared tenant-runtime API contract document.
  - app implementation paths containing schema/migration additionally require
    a changed schema or migration document under <app>/docs.
  - data-runtime/internal/migrations/<scope> non-test Go changes require a
    changed Go test in that scope and every mapped business schema document.

--changed-files-file reads one repository-relative path per line. Blank lines
and lines beginning with # are ignored, which makes it suitable for fixtures.
--self-test runs the checked-in pass-* and fail-* fixtures.
`
}

function normalizePath(file) {
  return file.trim().replaceAll('\\', '/').replace(/^\.\//, '')
}

function parseChangedFiles(content) {
  return [...new Set(content
    .split(/\r?\n/)
    .map(normalizePath)
    .filter(file => file.length > 0 && !file.startsWith('#')))]
    .sort()
}

function parseGitChangedFiles(content) {
  return [...new Set(content
    .split('\0')
    .map(normalizePath)
    .filter(Boolean))]
    .sort()
}

function parseArguments(argv) {
  const options = {
    base: undefined,
    changedFilesFile: undefined,
    selfTest: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]

    if (argument === '--help' || argument === '-h') {
      console.info(usage().trim())
      process.exit(0)
    }

    if (argument === '--self-test') {
      options.selfTest = true
      continue
    }

    if (argument === '--base' || argument === '--changed-files-file') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value`)
      }
      if (argument === '--base') {
        options.base = value
      } else {
        options.changedFilesFile = resolve(process.cwd(), value)
      }
      index += 1
      continue
    }

    throw new Error(`unknown argument: ${argument}`)
  }

  const selectedSources = [options.base, options.changedFilesFile, options.selfTest]
    .filter(Boolean)
  if (selectedSources.length > 1) {
    throw new Error('--base, --changed-files-file, and --self-test are mutually exclusive')
  }

  return options
}

function git(args, cwd = WORKSPACE_ROOT) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || `exit code ${result.status}`}`)
  }
  return result.stdout
}

function selectGitBase(explicitBase) {
  return explicitBase || 'HEAD'
}

function gitRepositoryChangedFiles(repositoryRoot, base) {
  const tracked = parseGitChangedFiles(git([
    'diff',
    '--name-only',
    '--diff-filter=ACMRD',
    '-z',
    base,
    '--'
  ], repositoryRoot))
  const untracked = parseGitChangedFiles(git([
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z'
  ], repositoryRoot))
  return [...new Set([...tracked, ...untracked])].sort()
}

function loadChangedFiles(options) {
  if (options.changedFilesFile) {
    if (!existsSync(options.changedFilesFile)) {
      throw new Error(`changed-files fixture is missing: ${options.changedFilesFile}`)
    }
    return {
      files: parseChangedFiles(readFileSync(options.changedFilesFile, 'utf8')),
      source: options.changedFilesFile
    }
  }

  const base = selectGitBase(options.base)
  const changedFiles = gitRepositoryChangedFiles(WORKSPACE_ROOT, base)

  return {
    files: [...new Set(changedFiles)].sort(),
    source: `monorepo git diff ${base} plus untracked files`
  }
}

function isGoTest(file) {
  return file.endsWith('_test.go')
}

function appImplementation(file) {
  const match = file.match(/^data-runtime\/internal\/apps\/([^/]+)\/(.+\.go)$/)
  if (!match || isGoTest(file)) return undefined
  return { app: match[1], relativePath: match[2] }
}

function serverImplementation(file) {
  return /^data-runtime\/internal\/server\/.+\.go$/.test(file) && !isGoTest(file)
}

function migrationImplementation(file) {
  const match = file.match(/^data-runtime\/internal\/migrations\/([^/]+)\/(.+\.go)$/)
  if (!match || isGoTest(file)) return undefined
  return { scope: match[1], relativePath: match[2] }
}

function hasSchemaOrMigrationMeaning(file) {
  return /(?:^|[/_.-])(?:schemas?|migrations?)(?:$|[/_.-])/i.test(file)
}

function isAppTest(file, app) {
  return file.startsWith(`data-runtime/internal/apps/${app}/`) && isGoTest(file)
}

function isServerTest(file) {
  return file.startsWith('data-runtime/internal/server/') && isGoTest(file)
}

function isMigrationTest(file, scope) {
  return file.startsWith(`data-runtime/internal/migrations/${scope}/`) && isGoTest(file)
}

function isApiContractDocument(file, app) {
  if (SHARED_API_CONTRACT_DOCUMENTS.has(file)) return true
  if (file.startsWith(`data-runtime/openapi/${app}.`)) return true
  if (!file.startsWith(`${app}/docs/`)) return false

  const name = basename(file).toLowerCase()
  return name.includes('api') && (name.includes('spec') || name.includes('contract'))
}

function isSharedApiContractDocument(file) {
  return SHARED_API_CONTRACT_DOCUMENTS.has(file)
    || file.startsWith('data-runtime/openapi/runtime.')
}

function isSchemaDocument(file, app) {
  if (!file.startsWith(`${app}/docs/`)) return false
  const name = basename(file).toLowerCase()
  return name.includes('schema') || (name.endsWith('.sql') && name.includes('migration'))
}

function formatExamples(files, limit = 3) {
  const selected = files.slice(0, limit)
  return `${selected.join(', ')}${files.length > limit ? ` (+${files.length - limit} more)` : ''}`
}

function evaluateChangedFiles(files) {
  const failures = []
  const checks = []
  const appChanges = new Map()
  const migrationChanges = new Map()
  const serverChanges = files.filter(serverImplementation)

  for (const file of files) {
    const implementation = appImplementation(file)
    if (implementation) {
      const current = appChanges.get(implementation.app) ?? []
      current.push(file)
      appChanges.set(implementation.app, current)
    }

    const migration = migrationImplementation(file)
    if (migration) {
      const current = migrationChanges.get(migration.scope) ?? []
      current.push(file)
      migrationChanges.set(migration.scope, current)
    }
  }

  for (const [app, implementationFiles] of [...appChanges].sort(([left], [right]) => left.localeCompare(right))) {
    checks.push(`${app} app API/implementation`)

    if (!files.some(file => isAppTest(file, app))) {
      failures.push(`${app}: runtime implementation changed (${formatExamples(implementationFiles)}) but no corresponding Go test changed under data-runtime/internal/apps/${app}/`)
    }
    if (!files.some(file => isApiContractDocument(file, app))) {
      failures.push(`${app}: runtime implementation changed but no corresponding API contract changed; update data-runtime/README.md, docs/Tenant-Runtime-API-Contract-v1.md, docs/MODULE_CONTRACTS.md, data-runtime/openapi/${app}.*, or an ${app}/docs API spec`)
    }

    const schemaFiles = implementationFiles.filter(hasSchemaOrMigrationMeaning)
    if (schemaFiles.length > 0) {
      checks.push(`${app} app schema/migration`)
      if (!files.some(file => isSchemaDocument(file, app))) {
        failures.push(`${app}: schema/migration implementation changed (${formatExamples(schemaFiles)}) but no schema or migration document changed under ${app}/docs/`)
      }
    }
  }

  if (serverChanges.length > 0) {
    checks.push('tenant-runtime server routes/API')
    if (!files.some(isServerTest)) {
      failures.push(`server: route/API implementation changed (${formatExamples(serverChanges)}) but no corresponding Go test changed under data-runtime/internal/server/`)
    }
    if (!files.some(isSharedApiContractDocument)) {
      failures.push('server: route/API implementation changed but no shared tenant-runtime API contract changed; update data-runtime/README.md, docs/Tenant-Runtime-API-Contract-v1.md, docs/MODULE_CONTRACTS.md, or data-runtime/openapi/runtime.*')
    }
  }

  for (const [scope, implementationFiles] of [...migrationChanges].sort(([left], [right]) => left.localeCompare(right))) {
    checks.push(`${scope} standalone migration`)
    if (!files.some(file => isMigrationTest(file, scope))) {
      failures.push(`${scope}: migration implementation changed (${formatExamples(implementationFiles)}) but no corresponding Go test changed under data-runtime/internal/migrations/${scope}/`)
    }

    const requiredSchemaDocuments = MIGRATION_SCHEMA_DOCUMENTS.get(scope)
    if (!requiredSchemaDocuments) {
      failures.push(`${scope}: migration scope has no schema-document mapping; add it to MIGRATION_SCHEMA_DOCUMENTS in scripts/validate-runtime-contract-changes.mjs`)
      continue
    }

    for (const requirement of requiredSchemaDocuments) {
      if (!files.some(file => isSchemaDocument(file, requirement.app))) {
        failures.push(`${scope}: migration implementation changed but ${requirement.label} did not; update a schema or migration document under ${requirement.app}/docs/`)
      }
    }
  }

  return { checks, failures }
}

function reportEvaluation(files, source, evaluation) {
  console.info(`[runtime-contract-changes] source: ${source}`)
  console.info(`[runtime-contract-changes] changed files: ${files.length}`)

  if (evaluation.checks.length === 0) {
    console.info('[runtime-contract-changes] no guarded tenant-runtime implementation changes detected')
  } else {
    console.info(`[runtime-contract-changes] guarded changes: ${evaluation.checks.join(', ')}`)
  }

  if (evaluation.failures.length > 0) {
    console.error('[runtime-contract-changes] failed:')
    for (const failure of evaluation.failures) {
      console.error(`  - ${failure}`)
    }
    console.error('[runtime-contract-changes] this is a changed-file association gate; run go test ./... separately')
    return false
  }

  console.info('[runtime-contract-changes] passed (changed-file associations only; Go tests were not executed)')
  return true
}

function runSelfTest() {
  if (!existsSync(FIXTURE_DIRECTORY)) {
    throw new Error(`fixture directory is missing: ${FIXTURE_DIRECTORY}`)
  }

  const fixtureNames = readdirSync(FIXTURE_DIRECTORY)
    .filter(name => /^(?:pass|fail)-.+\.txt$/.test(name))
    .sort()
  if (fixtureNames.length === 0) {
    throw new Error(`no pass-* or fail-* fixtures found in ${FIXTURE_DIRECTORY}`)
  }

  const failures = []
  for (const fixtureName of fixtureNames) {
    const fixturePath = resolve(FIXTURE_DIRECTORY, fixtureName)
    const files = parseChangedFiles(readFileSync(fixturePath, 'utf8'))
    const evaluation = evaluateChangedFiles(files)
    const actualPass = evaluation.failures.length === 0
    const expectedPass = fixtureName.startsWith('pass-')
    const outcome = actualPass === expectedPass ? 'ok' : 'mismatch'
    console.info(`[runtime-contract-changes:self-test] ${fixtureName}: expected ${expectedPass ? 'pass' : 'fail'}, got ${actualPass ? 'pass' : 'fail'} (${outcome})`)
    if (actualPass !== expectedPass) {
      failures.push(`${fixtureName}: ${evaluation.failures.join('; ') || 'unexpectedly passed'}`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`fixture expectations failed:\n  - ${failures.join('\n  - ')}`)
  }
  console.info(`[runtime-contract-changes:self-test] passed (${fixtureNames.length} fixtures)`)
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.selfTest) {
    runSelfTest()
    return
  }

  const { files, source } = loadChangedFiles(options)
  const passed = reportEvaluation(files, source, evaluateChangedFiles(files))
  if (!passed) process.exitCode = 1
}

try {
  main()
} catch (error) {
  console.error(`[runtime-contract-changes] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
