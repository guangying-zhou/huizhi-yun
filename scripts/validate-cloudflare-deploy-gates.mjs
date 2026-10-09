#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXPECTED_MODULES = [
  'aims',
  'altoc',
  'assets',
  'codocs',
  'console',
  'finance',
  'people',
  'platform',
  'webdev',
  'workflow'
]
const FORBIDDEN_RELEASE_COMMANDS = [
  'deploy:cloudflare',
  'wrangler deploy',
  "'accept:",
  "'probe:",
  "'token:cloudflare-internal'",
  "'verify:pm2-live'"
]

function fail(message) {
  throw new Error(message)
}

function packageJson(moduleName) {
  const path = resolve(WORKSPACE_ROOT, moduleName, 'package.json')
  if (!existsSync(path)) fail(`${moduleName}: missing package.json`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function deployedModules() {
  return readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'account')
    .filter(entry => existsSync(resolve(WORKSPACE_ROOT, entry.name, 'package.json')))
    .filter(entry => typeof packageJson(entry.name).scripts?.['deploy:cloudflare'] === 'string')
    .map(entry => entry.name)
    .sort()
}

function requireOrdered(script, fragments, label) {
  let previousIndex = -1
  for (const fragment of fragments) {
    const index = script.indexOf(fragment, previousIndex + 1)
    if (index < 0) fail(`${label}: missing ordered command ${JSON.stringify(fragment)}`)
    previousIndex = index
  }
}

function validateModule(moduleName) {
  const manifest = packageJson(moduleName)
  const scripts = manifest.scripts || {}
  const preflight = String(scripts['preflight:cloudflare'] || '')
  const verify = String(scripts['verify:cloudflare-deploy'] || '')
  const deploy = String(scripts['deploy:cloudflare'] || '')
  const build = String(scripts['build:cloudflare'] || '')
  const usesLocalWrangler = verify.includes('pnpm exec wrangler deploy') || deploy.includes('pnpm exec wrangler deploy')
  const wranglerCommand = usesLocalWrangler
    ? 'pnpm exec wrangler deploy'
    : 'pnpm dlx wrangler@4.110.0 deploy'
  const pinnedWrangler = manifest.devDependencies?.wrangler || manifest.dependencies?.wrangler

  if (usesLocalWrangler && pinnedWrangler !== '4.110.0') {
    fail(`${moduleName}: local Wrangler deployment requires wrangler=4.110.0 in package.json`)
  }

  requireOrdered(preflight, ['pnpm run lint', 'pnpm run typecheck', 'pnpm run test'], `${moduleName} preflight:cloudflare`)
  if (preflight.includes('--if-present')) {
    fail(`${moduleName}: preflight must fail when a required quality script is missing`)
  }
  if (!build) fail(`${moduleName}: build:cloudflare is required`)

  if (moduleName === 'platform') {
    requireOrdered(verify, [
      'pnpm run preflight:cloudflare',
      'pnpm run build:cloudflare',
      `${wranglerCommand} --dry-run`,
      '--outdir .output/wrangler-dry-run'
    ], `${moduleName} verify:cloudflare-deploy`)
  } else {
    if (typeof scripts['cloudflare:config'] !== 'string' || !scripts['cloudflare:config'].trim()) {
      fail(`${moduleName}: cloudflare:config is required before deployment`)
    }
    requireOrdered(verify, [
      'pnpm run preflight:cloudflare',
      'pnpm run cloudflare:config',
      'pnpm run build:cloudflare',
      `${wranglerCommand} --dry-run`,
      '--outdir .output/wrangler-dry-run'
    ], `${moduleName} verify:cloudflare-deploy`)
  }

  if ((verify.split(wranglerCommand).length - 1) !== 1 || !verify.includes('--dry-run')) {
    fail(`${moduleName}: verify:cloudflare-deploy must contain exactly one dry-run Wrangler deployment`)
  }

  requireOrdered(deploy, [
    'pnpm run verify:cloudflare-deploy',
    wranglerCommand
  ], `${moduleName} deploy:cloudflare`)
  if (deploy.includes('--dry-run')) fail(`${moduleName}: deploy:cloudflare must perform the real deploy after verification`)
  if ((deploy.split(wranglerCommand).length - 1) !== 1) {
    fail(`${moduleName}: deploy:cloudflare must contain exactly one real Wrangler deployment`)
  }

  if (moduleName === 'codocs' && !build.includes('--max-old-space-size=4096')) {
    fail('codocs: build:cloudflare must preserve the documented 4 GB Node heap')
  }
}

function validateRootReleaseCheck() {
  const scripts = packageJson('.').scripts || {}
  if (scripts['release:check'] !== 'node scripts/run-release-check.mjs') {
    fail('root release:check must use the versioned local release-check orchestrator')
  }

  const source = readFileSync(resolve(WORKSPACE_ROOT, 'scripts/run-release-check.mjs'), 'utf8')
  for (const forbidden of FORBIDDEN_RELEASE_COMMANDS) {
    if (source.includes(forbidden)) fail(`root release:check must not reference live/deploy command ${forbidden}`)
  }
}

try {
  const actualModules = deployedModules()
  if (JSON.stringify(actualModules) !== JSON.stringify(EXPECTED_MODULES)) {
    fail(`Cloudflare deploy module inventory changed; expected ${EXPECTED_MODULES.join(', ')}, got ${actualModules.join(', ')}`)
  }

  for (const moduleName of actualModules) validateModule(moduleName)
  validateRootReleaseCheck()
  console.info(`[cloudflare-deploy-gates] passed (${actualModules.length} modules: ${actualModules.join(', ')})`)
} catch (error) {
  console.error(`[cloudflare-deploy-gates] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
