#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const VERIFY_SCRIPT = 'scripts/verify-console-runtime-cache.mjs'

function envText(record) {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value ?? ''}`)
    .join('\n')
}

function writeEnvFile(dir, name, values) {
  const path = join(dir, name)
  writeFileSync(path, `${envText(values)}\n`, 'utf8')
  return path
}

function writeRowsFile(dir, name, rows) {
  const path = join(dir, name)
  writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
  return path
}

function cacheRow(cacheKey, payload) {
  return {
    cacheKey,
    payloadJson: JSON.stringify(payload),
    updatedAt: '2026-05-29 00:00:00'
  }
}

function baseEnv(overrides = {}) {
  return {
    DB_NAME: 'hzy_console',
    HZY_PLATFORM_TENANT_CODE: 'wiztek',
    HZY_PLATFORM_BUNDLE_CACHE_BACKEND: 'db',
    HZY_PLATFORM_BUNDLE_CACHE_TABLE: 'console_runtime_cache',
    HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK: 'false',
    ...overrides
  }
}

function baseRows({ prodHash = 'bundle-prod', testHash = 'bundle-test', prodDeployment = 'wiztek-console', testDeployment = 'wiztek-test-console', legacy = false } = {}) {
  const rows = [
    cacheRow('wiztek-console:policy_bundle', {
      tenantCode: 'wiztek',
      deploymentCode: prodDeployment,
      bundleVersion: 'prod-v1',
      bundleHash: prodHash,
      status: 'active'
    }),
    cacheRow('wiztek-console:activation_status', {
      tenantCode: 'wiztek',
      deploymentCode: prodDeployment,
      bundleVersion: 'prod-v1',
      bundleHash: prodHash,
      mode: 'active'
    }),
    cacheRow('wiztek-test-console:policy_bundle', {
      tenantCode: 'wiztek',
      deploymentCode: testDeployment,
      bundleVersion: 'test-v1',
      bundleHash: testHash,
      status: 'active'
    }),
    cacheRow('wiztek-test-console:activation_status', {
      tenantCode: 'wiztek',
      deploymentCode: testDeployment,
      bundleVersion: 'test-v1',
      bundleHash: testHash,
      mode: 'active'
    })
  ]

  if (legacy) {
    rows.push(cacheRow('policy_bundle', {
      tenantCode: 'wiztek',
      deploymentCode: 'legacy-console',
      bundleVersion: 'legacy-v1',
      bundleHash: 'legacy-hash',
      status: 'active'
    }))
  }

  return rows
}

function runVerifier(args) {
  return spawnSync(process.execPath, [VERIFY_SCRIPT, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })
}

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`
}

function assertPassed(label, result) {
  if (result.status !== 0) {
    throw new Error(`${label}: expected pass, got ${result.status}\n${outputOf(result)}`)
  }
  console.info(`[console-runtime-cache-guardrails] ${label} passed`)
}

function assertFailedWith(label, result, expectedMessages) {
  const output = outputOf(result)
  if (result.status === 0) {
    throw new Error(`${label}: expected failure, command exited 0\n${output}`)
  }
  for (const message of expectedMessages) {
    if (!output.includes(message)) {
      throw new Error(`${label}: expected output to include ${JSON.stringify(message)}\n${output}`)
    }
  }
  console.info(`[console-runtime-cache-guardrails] ${label} passed`)
}

function commonArgs(files, rowsFile, db = 'hzy_console') {
  return [
    '--db', db,
    '--console-prod-env', files.prod,
    '--console-test-env', files.test,
    '--cache-rows-file', rowsFile,
    '--require-prod-cache',
    '--require-test-cache'
  ]
}

function main() {
  const dir = mkdtempSync(join(tmpdir(), 'hzy-console-runtime-cache-guardrails-'))
  try {
    const files = {
      prod: writeEnvFile(dir, 'console-prod.env', baseEnv({
        HZY_PLATFORM_DEPLOYMENT_CODE: 'wiztek-console',
        HZY_PLATFORM_BUNDLE_CACHE_SCOPE: 'wiztek-console'
      })),
      test: writeEnvFile(dir, 'console-test.env', baseEnv({
        HZY_PLATFORM_DEPLOYMENT_CODE: 'wiztek-test-console',
        HZY_PLATFORM_BUNDLE_CACHE_SCOPE: 'wiztek-test-console'
      }))
    }

    const happyRows = writeRowsFile(dir, 'happy.json', baseRows())
    assertPassed('happy-path scoped cache fixture', runVerifier(commonArgs(files, happyRows)))

    const wrongDb = runVerifier(commonArgs(files, happyRows, 'hzy_console_wrong'))
    assertFailedWith('wrong DB name is rejected', wrongDb, [
      '--db must match Console DB_NAME from env files'
    ])

    const sameBundleHashRows = writeRowsFile(dir, 'same-bundle-hash.json', baseRows({ prodHash: 'same-hash', testHash: 'same-hash' }))
    assertFailedWith('prod/test bundle hash collision is rejected', runVerifier(commonArgs(files, sameBundleHashRows)), [
      'console-prod and console-test policy_bundle cache rows must not share bundleHash',
      'console-prod and console-test activation_status cache rows must not share bundleHash'
    ])

    const legacyRows = writeRowsFile(dir, 'legacy.json', baseRows({ legacy: true }))
    assertFailedWith('legacy unscoped cache key is rejected', runVerifier(commonArgs(files, legacyRows)), [
      'legacy unscoped cache keys must be removed'
    ])

    const mismatchRows = writeRowsFile(dir, 'deployment-mismatch.json', baseRows({ prodDeployment: 'wiztek-test-console' }))
    assertFailedWith('payload deployment mismatch is rejected', runVerifier(commonArgs(files, mismatchRows)), [
      'wiztek-console:policy_bundle deploymentCode mismatch',
      'wiztek-console:activation_status deploymentCode mismatch'
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  console.info('[console-runtime-cache-guardrails] passed')
}

try {
  main()
} catch (error) {
  console.error(`[console-runtime-cache-guardrails] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
