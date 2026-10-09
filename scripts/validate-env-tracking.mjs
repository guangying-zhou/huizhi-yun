#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const MODULES = [
  {
    name: 'console',
    dir: 'console',
    requiredExamples: [
      '.env.example',
      '.env.prod.example',
      '.env.test.example',
      '.env.dev.example',
      '.env.cloudflare.example'
    ]
  },
  {
    name: 'platform',
    dir: 'platform',
    requiredExamples: [
      '.env.example',
      '.env.prod.example',
      '.env.dev.example',
      '.env.cloudflare.example'
    ]
  }
]

const FORBIDDEN_UNIGNORE_LINES = [
  '!.env',
  '!.env.prod',
  '!.env.test',
  '!.env.cloudflare'
]

const ALLOWED_REAL_ENV_FILES = new Set([
  '.env.dev'
])

function usage() {
  return `
Usage:
  pnpm run validate:env-tracking

Checks that Console and Platform keep .env/prod/test/cloudflare runtime env
files out of git while tracking safe *.example env templates. Development
`.env.dev` files may be tracked for non-secret local defaults. Other tracked
real env files are accepted only when already deleted in the current worktree,
so this migration can be validated before the deletion commit is created.
`
}

function fail(message) {
  console.error(`[env-tracking] ${message}`)
  process.exit(1)
}

function git(args, cwd = process.cwd()) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8'
  })
  if (result.error) throw result.error
  return result
}

function listTrackedEnvFiles(moduleDir) {
  const result = git(['-C', moduleDir, 'ls-files', '.env*'])
  if (result.status !== 0) {
    fail(`${moduleDir}: failed to list tracked env files: ${result.stderr.trim()}`)
  }
  return result.stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}

function isDeletedTrackedFile(moduleDir, file) {
  const result = git(['-C', moduleDir, 'ls-files', '--deleted', '--error-unmatch', file])
  return result.status === 0
}

function isAllowedEnvTemplate(file) {
  return file === '.env.example' || file.endsWith('.example')
}

function isAllowedTrackedEnvFile(file) {
  return isAllowedEnvTemplate(file) || ALLOWED_REAL_ENV_FILES.has(file)
}

function validateGitignore(moduleConfig) {
  const gitignorePath = `${moduleConfig.dir}/.gitignore`
  if (!existsSync(gitignorePath)) {
    fail(`${gitignorePath} is missing`)
  }

  const lines = readFileSync(gitignorePath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  for (const line of ['.env', '.env.*', '!.env.example']) {
    if (!lines.includes(line)) {
      fail(`${gitignorePath} must contain ${line}`)
    }
  }

  if (!lines.includes('!.env.*.example') && !lines.includes('!.env.cloudflare.example')) {
    fail(`${gitignorePath} must unignore tracked env example files`)
  }

  for (const line of FORBIDDEN_UNIGNORE_LINES) {
    if (lines.includes(line)) {
      fail(`${gitignorePath} must not unignore real env file ${line.slice(1)}`)
    }
  }
}

function validateModule(moduleConfig) {
  validateGitignore(moduleConfig)

  for (const file of moduleConfig.requiredExamples) {
    if (!existsSync(`${moduleConfig.dir}/${file}`)) {
      fail(`${moduleConfig.dir}/${file} is missing`)
    }
  }

  const tracked = listTrackedEnvFiles(moduleConfig.dir)
  for (const file of tracked) {
    if (isAllowedTrackedEnvFile(file)) {
      continue
    }

    if (isDeletedTrackedFile(moduleConfig.dir, file)) {
      console.info(`[env-tracking] ${moduleConfig.dir}/${file} is tracked only as a pending deletion`)
      continue
    }

    fail(`${moduleConfig.dir}/${file} must not be tracked; keep .env/prod/test/cloudflare env files local and track only .env.dev or *.example templates`)
  }

  console.info(`[env-tracking] ${moduleConfig.name} passed`)
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.info(usage().trim())
    return
  }

  for (const moduleConfig of MODULES) {
    validateModule(moduleConfig)
  }

  console.info('[env-tracking] passed')
}

try {
  main()
} catch (error) {
  console.error(`[env-tracking] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
