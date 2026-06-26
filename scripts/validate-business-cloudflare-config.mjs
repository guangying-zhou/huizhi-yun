#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'

const MODULES = [
  { dir: 'aims', appCode: 'aims', prefix: 'AIMS' },
  { dir: 'altoc', appCode: 'altoc', prefix: 'ALTOC' },
  { dir: 'assets', appCode: 'assets', prefix: 'ASSETS' },
  { dir: 'codocs', appCode: 'codocs', prefix: 'CODOCS' },
  { dir: 'finance', appCode: 'finance', prefix: 'FINANCE' },
  { dir: 'people', appCode: 'people', prefix: 'PEOPLE' },
  { dir: 'workflow', appCode: 'workflow', prefix: 'WORKFLOW' },
  { dir: 'webdev', appCode: 'webdev', prefix: 'WEBDEV' }
]

const POLLUTED_TENANT_HOST = 'https://wiztek.huizhi.yun'

const AIMS_ALLOWED_NUXT_ONLY_FILES = [
  'aims/server/api/v1/codocs/department-documents.get.ts',
  'aims/server/api/v1/codocs/documents/[uuid]/content.get.ts',
  'aims/server/api/v1/codocs/documents/[uuid]/section.get.ts',
  'aims/server/api/v1/codocs/documents/[uuid]/summary.get.ts',
  'aims/server/api/v1/project-documents/accessible.get.ts',
  'aims/server/api/v1/projects/[id]/documents/[documentId]/access-audit.get.ts',
  'aims/server/api/v1/projects/[id]/documents/[documentId]/access-check.post.ts',
  'aims/server/api/v1/projects/[id]/documents/[documentId]/access-policy.get.ts',
  'aims/server/api/v1/projects/[id]/documents/[documentId]/access-policy.put.ts',
  'aims/server/api/v1/projects/[id]/documents/[documentId]/download.get.ts',
  'aims/server/api/v1/projects/[id]/markdown-documents.post.ts',
  'aims/server/api/v1/projects/[id]/other-documents.post.ts',
  'aims/server/api/v1/projects/[id]/requirement-targets.get.ts',
  'aims/server/api/v1/projects/[id]/requirements/index.get.ts',
  'aims/server/api/v1/projects/[id]/requirements/spec.get.ts'
]

const DB_ACCESS_PATTERN = /(?:server\/utils\/db|useDbPool|queryRow|queryRows|withTransaction|\bexecute\s*\()/

function fail(message) {
  throw new Error(message)
}

const tempDir = mkdtempSync(resolve(tmpdir(), 'hzy-business-cloudflare-'))

function runRenderer(module, outputPath) {
  const env = {
    ...process.env,
    [`HZY_${module.prefix}_WRANGLER_OUTPUT`]: outputPath,
    HZY_DEPLOYMENT_PROFILE: 'managed-cloud-direct-db',
    NUXT_PUBLIC_DEPLOYMENT_PROFILE: 'managed-cloud-direct-db',
    DEPLOYMENT_PROFILE: 'managed-cloud-direct-db',
    DB_NAME: `polluted_${module.appCode}`,
    DB_CONNECTION_LIMIT: '99',
    HZY_DEPLOYMENT_PUBLIC_URL: POLLUTED_TENANT_HOST,
    NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL: POLLUTED_TENANT_HOST,
    HZY_MANAGED_CONSOLE_URL: POLLUTED_TENANT_HOST,
    HZY_CONSOLE_URL: POLLUTED_TENANT_HOST,
    HZY_CONSOLE_API_URL: POLLUTED_TENANT_HOST,
    HZY_CONSOLE_RUNTIME_API_URL: POLLUTED_TENANT_HOST,
    NUXT_PUBLIC_CONSOLE_URL: POLLUTED_TENANT_HOST,
    HZY_TENANT_RUNTIME_URL: 'https://tenant-runtime.example.test',
    HZY_DATA_RUNTIME_URL: 'https://data-runtime.example.test',
    [`HZY_${module.prefix}_HYPERDRIVE_ID`]: '00000000-0000-0000-0000-000000000000'
  }

  const result = spawnSync(process.execPath, [`${module.dir}/scripts/render-cloudflare-config.mjs`], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8'
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    fail(`${module.dir} cloudflare config renderer failed:\n${result.stdout || ''}${result.stderr || ''}`)
  }
}

function readConfig(outputPath) {
  return JSON.parse(readFileSync(outputPath, 'utf8'))
}

function assertNoDatabaseBindings(config, module) {
  if (Array.isArray(config.hyperdrive) && config.hyperdrive.length) {
    fail(`${module.dir}: hyperdrive binding must not be generated`)
  }

  const vars = config.vars || {}
  const dbVars = Object.keys(vars).filter(key => key === 'DB_NAME' || key === 'DB_CONNECTION_LIMIT' || key.startsWith('DB_'))
  if (dbVars.length) {
    fail(`${module.dir}: DB vars must not be generated: ${dbVars.join(', ')}`)
  }
}

function assertAgentProfile(config, module) {
  const vars = config.vars || {}
  if (vars.HZY_DEPLOYMENT_PROFILE !== 'managed-cloud-agent') {
    fail(`${module.dir}: HZY_DEPLOYMENT_PROFILE must be managed-cloud-agent`)
  }
  if (vars.NUXT_PUBLIC_DEPLOYMENT_PROFILE !== 'managed-cloud-agent') {
    fail(`${module.dir}: NUXT_PUBLIC_DEPLOYMENT_PROFILE must be managed-cloud-agent`)
  }
}

function assertTenantNeutralConsoleUrls(config, module) {
  const vars = config.vars || {}
  const sharedConsole = 'https://console.huizhi.yun'
  for (const key of [
    'HZY_CONSOLE_URL',
    'HZY_CONSOLE_API_URL',
    'HZY_CONSOLE_RUNTIME_API_URL',
    'NUXT_PUBLIC_CONSOLE_URL',
    'NUXT_PUBLIC_ACCOUNT_URL'
  ]) {
    if (vars[key] === POLLUTED_TENANT_HOST) {
      fail(`${module.dir}: ${key} must not bake tenant host ${POLLUTED_TENANT_HOST} into shared Cloudflare app Worker config`)
    }
    if (vars[key] !== sharedConsole) {
      fail(`${module.dir}: ${key} must resolve to ${sharedConsole}, got ${vars[key] || '<empty>'}`)
    }
  }
}

function assertNoPollutedTenantHost(config, module) {
  const vars = config.vars || {}
  const polluted = Object.entries(vars)
    .filter(([, value]) => String(value || '').startsWith(POLLUTED_TENANT_HOST))
    .map(([key, value]) => `${key}=${value}`)

  if (polluted.length) {
    fail(`${module.dir}: shared Cloudflare app Worker config must not bake tenant host ${POLLUTED_TENANT_HOST}: ${polluted.join(', ')}`)
  }
}

function assertAimsNuxtOnlyGuardrails() {
  const middleware = readFileSync('aims/server/middleware/tenant-runtime.ts', 'utf8')
  const allowedFunction = middleware.match(/function isAllowedNuxtApiV1Path[\s\S]*?\n}/)?.[0] || ''
  if (allowedFunction.includes('NUXT_ONLY_MARKERS.some')) {
    fail('aims: tenant-runtime middleware must not allow all NUXT_ONLY_MARKERS through to legacy Nuxt DB handlers')
  }

  for (const file of AIMS_ALLOWED_NUXT_ONLY_FILES) {
    const content = readFileSync(file, 'utf8')
    if (DB_ACCESS_PATTERN.test(content)) {
      fail(`${file}: allowed Nuxt-only Cloudflare path must not directly access Aims DB helpers`)
    }
  }
}

try {
  for (const module of MODULES) {
    const outputPath = resolve(tempDir, `${module.dir}.wrangler.generated.jsonc`)
    runRenderer(module, outputPath)
    const config = readConfig(outputPath)
    assertAgentProfile(config, module)
    assertNoDatabaseBindings(config, module)
    assertTenantNeutralConsoleUrls(config, module)
    assertNoPollutedTenantHost(config, module)
  }
  assertAimsNuxtOnlyGuardrails()
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}

console.info(`Business Cloudflare validation passed for ${MODULES.map(item => item.dir).join(', ')}.`)
