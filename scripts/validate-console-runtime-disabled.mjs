#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

const CHECKS = [
  {
    file: 'console/server/utils/platformRuntime.ts',
    description: 'runtime disabled activation status is treated as locally active',
    required: [
      'function runtimeDisabledActivationStatus()',
      "mode: 'active'",
      'activated: true',
      'envValid: true',
      'licenseValid: true',
      'bundleReady: false'
    ]
  },
  {
    file: 'console/server/utils/platformRuntime.ts',
    description: 'refreshPlatformBundle short-circuits before Platform config',
    ordered: [
      'export async function refreshPlatformBundle',
      'const runtimeMode = loadConsoleRuntimeMode(event)',
      'if (!runtimeMode.runtimeEnabled)',
      'return {',
      'ok: true',
      'const config = loadPlatformRuntimeConfig(event)'
    ]
  },
  {
    file: 'console/server/utils/platformRuntime.ts',
    description: 'loadActivationStatus short-circuits before Platform config',
    ordered: [
      'export async function loadActivationStatus',
      'const runtimeMode = loadConsoleRuntimeMode(event)',
      'if (!runtimeMode.runtimeEnabled)',
      'return runtimeDisabledActivationStatus()',
      'config = loadPlatformRuntimeConfig(event)'
    ]
  },
  {
    file: 'console/server/api/activation/status.get.ts',
    description: 'activation status returns disabled status before auto refresh',
    ordered: [
      'const status = await loadActivationStatus(event)',
      'if (status.activated)',
      'return {',
      "code: 0",
      "data: status",
      "refreshPlatformBundle('status-auto-refresh'"
    ]
  },
  {
    file: 'console/server/api/activation/bundle-refresh.post.ts',
    description: 'admin bundle refresh does not load Platform config when runtime is disabled',
    required: [
      "message: 'platform runtime disabled'",
      'refreshRequired: false',
      'refreshed: false'
    ],
    ordered: [
      'const runtimeMode = loadConsoleRuntimeMode(event)',
      'if (!runtimeMode.runtimeEnabled)',
      'return {',
      "message: 'platform runtime disabled'",
      'const config = loadPlatformRuntimeConfig(event)'
    ]
  },
  {
    file: 'console/server/plugins/bootstrap.ts',
    description: 'startup bootstrap skips Platform config when runtime is disabled',
    required: [
      '[console] platform runtime bootstrap skipped because HZY_PLATFORM_RUNTIME_ENABLED=false'
    ],
    ordered: [
      'const runtimeMode = loadConsoleRuntimeMode()',
      'if (!runtimeMode.runtimeEnabled)',
      'return',
      'const config = loadPlatformRuntimeConfig()'
    ]
  },
  {
    file: 'console/app/middleware/platform-bundle-refresh.global.ts',
    description: 'browser bundle refresh is admin-only and non-fatal',
    required: [
      "if (import.meta.server || !to.path.startsWith('/admin'))",
      "void $fetch<BundleRefreshResponse>('/api/activation/bundle-refresh'",
      '.catch((error) =>',
      'console.warn(`[console] admin bundle refresh check failed: ${message}`)'
    ]
  }
]

function usage() {
  return `
Usage:
  pnpm run validate:console-runtime-disabled

Checks that console-dev / runtime-disabled mode stays non-fatal for activation
status, manual retry, admin bundle refresh, and startup bootstrap. The goal is
to prevent regressions where local Console tries to load Platform runtime config
first and returns 503 before it can short-circuit.
`
}

function fail(message) {
  console.error(`[console-runtime-disabled] ${message}`)
  process.exit(1)
}

function readSource(file) {
  if (!existsSync(file)) {
    fail(`${file} is missing`)
  }
  return readFileSync(file, 'utf8')
}

function assertIncludes(source, file, description, required) {
  for (const needle of required || []) {
    if (!source.includes(needle)) {
      fail(`${description} in ${file} must include ${needle}`)
    }
  }
}

function assertOrdered(source, file, description, ordered) {
  let fromIndex = 0
  for (const needle of ordered || []) {
    const index = source.indexOf(needle, fromIndex)
    if (index < 0) {
      fail(`${description} in ${file} must include ${needle} after offset ${fromIndex}`)
    }
    fromIndex = index + needle.length
  }
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.info(usage().trim())
    return
  }

  for (const check of CHECKS) {
    const source = readSource(check.file)
    assertIncludes(source, check.file, check.description, check.required)
    assertOrdered(source, check.file, check.description, check.ordered)
    console.info(`[console-runtime-disabled] ${check.description} passed`)
  }

  console.info('[console-runtime-disabled] passed')
}

try {
  main()
} catch (error) {
  console.error(`[console-runtime-disabled] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
