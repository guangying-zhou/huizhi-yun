#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

function usage() {
  return `
Usage:
  pnpm run validate:runtime-isolation:keys

Generates temporary prod/dev Platform Ed25519 keys and matching Console
activation public material, then runs positive and negative
validate-runtime-isolation --strict cases. No generated secret is printed or
persisted.
`
}

function buildKid(publicKeyPem) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const digest = createHash('sha256').update(publicKeyPem).digest('base64url').slice(0, 12)
  return `psk_${date}_${digest}`
}

function generatePlatformKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

  return {
    privateEnv: `base64:${Buffer.from(privatePem, 'utf8').toString('base64')}`,
    publicEnv: publicPem.replace(/\n/g, '\\n'),
    kid: buildKid(publicPem)
  }
}

function writeEnv(path, lines) {
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')
}

function writeFixture(dir, options = {}) {
  const prod = options.prod || generatePlatformKey()
  const dev = options.dev || generatePlatformKey()
  const consoleProdKey = options.consoleProdKey || prod
  const consoleTestKey = options.consoleTestKey || dev

  writeEnv(join(dir, 'platform-prod.env'), [
    'DB_NAME=hzy_platform',
    'PLATFORM_SERVICE_URL=https://platform.wiztek.cn',
    'HZY_PLATFORM_PM2_NAME=hzy-platform-prod',
    'HOST=127.0.0.1',
    'PORT=3010',
    `HZY_PLATFORM_SIGNING_PRIVATE_KEY=${prod.privateEnv}`
  ])

  writeEnv(join(dir, 'platform-dev.env'), [
    'DB_NAME=hzy_platform_dev',
    'PLATFORM_SERVICE_URL=https://platform-dev.wiztek.cn',
    'HZY_PLATFORM_PM2_NAME=hzy-platform-dev',
    'HOST=127.0.0.1',
    'PORT=3011',
    `HZY_PLATFORM_SIGNING_PRIVATE_KEY=${dev.privateEnv}`
  ])

  writeEnv(join(dir, 'console-prod.env'), [
    'DB_NAME=hzy_console',
    'HZY_CONSOLE_RUN_MODE=prod',
    'HZY_CONSOLE_PM2_NAME=hzy-console-prod',
    'HOST=127.0.0.1',
    'PORT=3030',
    'HZY_CONSOLE_TRUST_TENANT_GATEWAY=false',
    'HZY_PLATFORM_RUNTIME_ENABLED=true',
    'HZY_PLATFORM_HEARTBEAT_ENABLED=true',
    'HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT=true',
    'HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE=true',
    'HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE=upsert',
    'HZY_CONSOLE_BACKGROUND_JOBS_ENABLED=true',
    'HZY_CONSOLE_DEV_POLICY_BYPASS=false',
    'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE=false',
    'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE=false',
    'CONSOLE_COLLAB_MODE=disabled',
    'HZY_PLATFORM_URL=https://platform.wiztek.cn',
    'HZY_PLATFORM_TENANT_CODE=wiztek',
    'HZY_PLATFORM_DEPLOYMENT_CODE=wiztek-console',
    'HZY_PLATFORM_RUNTIME_TOKEN=prod-runtime-token',
    'HZY_PLATFORM_LICENSE_TOKEN=prod-license-token',
    `HZY_PLATFORM_SIGNING_KID=${consoleProdKey.kid}`,
    `HZY_PLATFORM_SIGNING_PUBKEY="${consoleProdKey.publicEnv}"`,
    'HZY_PLATFORM_BUNDLE_CACHE_BACKEND=file',
    'HZY_PLATFORM_BUNDLE_CACHE_DIR=.data/platform-runtime',
    'HZY_PLATFORM_BUNDLE_CACHE_SCOPE=wiztek-console',
    'HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK=false',
    'HZY_DEPLOYMENT_PUBLIC_URL=https://hzy.wiztek.cn',
    'SSO_OIDC_REDIRECT_URI=https://hzy.wiztek.cn/api/auth/oidc-callback',
    'SSO_OIDC_POST_LOGOUT_REDIRECT_URI=https://hzy.wiztek.cn/api/auth/oidc-post-logout'
  ])

  writeEnv(join(dir, 'console-test.env'), [
    'DB_NAME=hzy_console',
    'HZY_CONSOLE_RUN_MODE=test',
    'HZY_CONSOLE_PM2_NAME=hzy-console-test',
    'HOST=127.0.0.1',
    'PORT=3031',
    'HZY_CONSOLE_TRUST_TENANT_GATEWAY=false',
    'HZY_PLATFORM_RUNTIME_ENABLED=true',
    'HZY_PLATFORM_HEARTBEAT_ENABLED=true',
    'HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT=true',
    'HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE=true',
    'HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE=append',
    'HZY_CONSOLE_BACKGROUND_JOBS_ENABLED=true',
    'HZY_CONSOLE_DEV_POLICY_BYPASS=false',
    'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE=false',
    'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE=false',
    'CONSOLE_COLLAB_MODE=disabled',
    'HZY_PLATFORM_URL=https://platform-dev.wiztek.cn',
    'HZY_PLATFORM_TENANT_CODE=wiztek',
    'HZY_PLATFORM_DEPLOYMENT_CODE=wiztek-test-console',
    'HZY_PLATFORM_RUNTIME_TOKEN=test-runtime-token',
    'HZY_PLATFORM_LICENSE_TOKEN=test-license-token',
    `HZY_PLATFORM_SIGNING_KID=${consoleTestKey.kid}`,
    `HZY_PLATFORM_SIGNING_PUBKEY="${consoleTestKey.publicEnv}"`,
    'HZY_PLATFORM_BUNDLE_CACHE_BACKEND=file',
    'HZY_PLATFORM_BUNDLE_CACHE_DIR=.data/platform-runtime-test',
    'HZY_PLATFORM_BUNDLE_CACHE_SCOPE=wiztek-test-console',
    'HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK=false',
    'HZY_DEPLOYMENT_PUBLIC_URL=https://hzy-test.wiztek.cn',
    'SSO_OIDC_REDIRECT_URI=https://hzy-test.wiztek.cn/api/auth/oidc-callback',
    'SSO_OIDC_POST_LOGOUT_REDIRECT_URI=https://hzy-test.wiztek.cn/api/auth/oidc-post-logout'
  ])

  return { prod, dev }
}

function validatorArgs(dir) {
  return [
    'scripts/validate-runtime-isolation.mjs',
    '--strict',
    '--platform-prod-env',
    join(dir, 'platform-prod.env'),
    '--platform-dev-env',
    join(dir, 'platform-dev.env'),
    '--console-prod-env',
    join(dir, 'console-prod.env'),
    '--console-test-env',
    join(dir, 'console-test.env'),
    '--console-dev-env',
    'console/.env.dev.example'
  ]
}

function runFixture(dir, options = {}) {
  const result = spawnSync(process.execPath, validatorArgs(dir), {
    cwd: process.cwd(),
    encoding: 'utf8'
  })

  if (result.error) throw result.error

  const output = `${result.stdout || ''}${result.stderr || ''}`
  if (options.expectFailure) {
    if (result.status === 0) {
      process.stdout.write(result.stdout || '')
      process.stderr.write(result.stderr || '')
      throw new Error(`${options.label || 'negative fixture'} unexpectedly passed`)
    }
    if (options.expectedOutput && !output.includes(options.expectedOutput)) {
      process.stdout.write(result.stdout || '')
      process.stderr.write(result.stderr || '')
      throw new Error(`${options.label || 'negative fixture'} failed without expected message: ${options.expectedOutput}`)
    }
    console.info(`[runtime-isolation-keys] ${options.label || 'negative fixture'} rejected as expected`)
    return
  }

  if (result.status !== 0) {
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    throw new Error(`validate-runtime-isolation strict key fixture failed with exit code ${result.status}`)
  }

  console.info(`[runtime-isolation-keys] ${options.label || 'positive fixture'} passed`)
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.info(usage().trim())
    return
  }

  const dir = mkdtempSync(resolve(tmpdir(), 'hzy-runtime-isolation-keys-'))
  try {
    const keys = writeFixture(dir)
    runFixture(dir, { label: 'matching prod/dev key fixture' })

    writeFixture(dir, {
      prod: keys.prod,
      dev: keys.dev,
      consoleTestKey: keys.prod
    })
    runFixture(dir, {
      label: 'console-test pubkey pointing at platform-prod',
      expectFailure: true,
      expectedOutput: 'console-test HZY_PLATFORM_SIGNING_PUBKEY must match platform-dev signing key'
    })

    writeFixture(dir, {
      prod: keys.prod,
      dev: keys.prod,
      consoleTestKey: keys.prod
    })
    runFixture(dir, {
      label: 'platform-prod/platform-dev sharing one private key',
      expectFailure: true,
      expectedOutput: 'Platform prod/dev signing private keys must resolve to different Ed25519 public keys'
    })

    console.info('[runtime-isolation-keys] passed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  console.error(`[runtime-isolation-keys] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
