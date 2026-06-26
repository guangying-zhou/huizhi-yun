#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const CHECKS = [
  {
    file: 'scripts/probe-console-runtime.mjs',
    description: 'Console runtime probe rejects prod/test runtime collisions',
    required: [
      'console-prod and console-test must use different deploymentCode',
      'console-prod and console-test must use different Platform baseUrl',
      'console-prod and console-test must use different Platform signing kid',
      'console-prod and console-test must use different public URL',
      'console-prod and console-test DB cache scopes must differ',
      'console-prod and console-test file cache dirs must differ',
      'console-prod and console-test policy bundle hashes must differ',
      "authClientMaterializeMode: 'disabled'",
      'data.platform?.configured',
      'data.cache?.table',
      'auth signing private key is not usable'
    ]
  },
  {
    file: 'scripts/probe-platform-runtime.mjs',
    description: 'Platform runtime probe rejects prod/dev runtime collisions',
    required: [
      'prod/dev Platform DB must be different',
      'prod/dev Platform PM2 names must be different',
      'prod/dev Platform ports must be different',
      'prod/dev Platform stages must be different',
      'prod/dev Platform serviceUrl must be different',
      'prod/dev Platform signing public key fingerprints must be different',
      'active signing private key is not usable'
    ]
  }
]

function usage() {
  return `
Usage:
  pnpm run validate:runtime-probe-guardrails

Checks that deployment-time Platform / Console runtime probes still contain and
enforce the pairwise assertions needed to catch prod/test/dev environment
collisions. It also runs local HTTP fixtures through the real probe scripts.
`
}

function fail(message) {
  console.error(`[runtime-probe-guardrails] ${message}`)
  process.exit(1)
}

function readSource(file) {
  if (!existsSync(file)) {
    fail(`${file} is missing`)
  }
  return readFileSync(file, 'utf8')
}

function platformEnv(options) {
  return {
    HZY_PLATFORM_PM2_NAME: options.pm2Name,
    HOST: '127.0.0.1',
    PORT: String(options.port),
    PLATFORM_SERVICE_URL: options.serviceUrl,
    NUXT_PUBLIC_PLATFORM_STAGE: options.stage,
    HZY_DEPLOYMENT_PROFILE: 'platform-self-hosted-db',
    DB_NAME: options.databaseName
  }
}

function consoleEnv(options) {
  const runtimeEnabled = options.runtimeEnabled ?? true
  return {
    HZY_CONSOLE_RUN_MODE: options.runMode,
    HZY_PLATFORM_RUNTIME_ENABLED: String(runtimeEnabled),
    HZY_PLATFORM_HEARTBEAT_ENABLED: String(options.heartbeatEnabled ?? runtimeEnabled),
    HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT: String(options.bundleRefreshOnBoot ?? runtimeEnabled),
    HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE: String(options.authClientMaterializeEnabled ?? runtimeEnabled),
    HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE: options.authClientMode,
    HZY_CONSOLE_BACKGROUND_JOBS_ENABLED: 'true',
    HZY_CONSOLE_DEV_POLICY_BYPASS: String(options.devPolicyBypass ?? false),
    HZY_CONSOLE_TRUST_TENANT_GATEWAY: 'false',
    HZY_PLATFORM_URL: options.platformUrl,
    HZY_PLATFORM_TENANT_CODE: 'wiztek',
    HZY_PLATFORM_DEPLOYMENT_CODE: options.deploymentCode,
    HZY_PLATFORM_BUNDLE_CACHE_BACKEND: 'file',
    HZY_PLATFORM_BUNDLE_CACHE_DIR: options.cacheDir,
    HZY_PLATFORM_BUNDLE_CACHE_SCOPE: options.deploymentCode,
    HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK: 'false',
    HZY_DEPLOYMENT_PUBLIC_URL: options.publicUrl,
    CONSOLE_COLLAB_MODE: options.collabMode,
    COLLAB_PORT: String(options.collabPort || ''),
    COLLAB_DB_NAME: options.collabDbName || '',
    CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE: 'false',
    CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE: 'false',
    DB_NAME: 'hzy_console'
  }
}

function envText(record) {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value ?? ''}`)
    .join('\n')
}

function writeEnvFile(dir, name, env) {
  const path = join(dir, name)
  writeFileSync(path, `${envText(env)}\n`, 'utf8')
  return path
}

function platformDiagnostics(options) {
  return {
    process: {
      pm2Name: options.pm2Name,
      host: '127.0.0.1',
      port: String(options.port)
    },
    platform: {
      serviceUrl: options.serviceUrl,
      stage: options.stage,
      deploymentProfile: 'platform-self-hosted-db'
    },
    database: {
      connected: true,
      configuredName: options.databaseName,
      databaseName: options.databaseName,
      error: null
    },
    signing: {
      activeKeyPresent: true,
      kid: options.signingKid,
      publicKeyFingerprint: options.publicKeyFingerprint,
      privateKeyUsable: true,
      error: null
    }
  }
}

function consoleDiagnostics(options) {
  const embeddedCollab = options.collabMode === 'embedded'
  const runtimeEnabled = options.runtimeEnabled ?? true
  const authClientMaterializeEnabled = options.authClientMaterializeEnabled ?? runtimeEnabled
  return {
    process: {
      deploymentPublicUrl: options.publicUrl
    },
    runtime: {
      runMode: options.runMode,
      runtimeEnabled,
      heartbeatEnabled: options.heartbeatEnabled ?? runtimeEnabled,
      bundleRefreshOnBoot: options.bundleRefreshOnBoot ?? runtimeEnabled,
      authClientMaterializeEnabled,
      backgroundJobsEnabled: options.backgroundJobsEnabled ?? true,
      devPolicyBypassEnabled: options.devPolicyBypass ?? false,
      trustTenantGateway: false
    },
    auth: {
      clientMaterializeMode: authClientMaterializeEnabled ? options.authClientMode : 'disabled',
      signingKeyAutogenerate: false,
      signingKeyRotateUnusable: false,
      signingKey: {
        currentKeyPresent: true,
        kid: options.authSigningKid,
        privateKeyUsable: true,
        error: null
      }
    },
    collab: {
      mode: options.collabMode,
      status: embeddedCollab ? 'running' : 'disabled',
      runtime: embeddedCollab
        ? {
            port: options.collabPort,
            database: { name: options.collabDbName }
          }
        : undefined
    },
    platform: {
      configured: options.platformConfigured ?? runtimeEnabled,
      baseUrl: runtimeEnabled ? options.platformUrl : null,
      tenantCode: runtimeEnabled ? 'wiztek' : null,
      deploymentCode: runtimeEnabled ? options.deploymentCode : null,
      signingKid: runtimeEnabled ? options.platformSigningKid : null
    },
    database: {
      connected: true,
      configuredName: 'hzy_console',
      databaseName: 'hzy_console',
      error: null
    },
    cache: {
      backend: 'file',
      cacheDir: options.cacheDir,
      scope: options.deploymentCode,
      legacyFallback: false
    },
    activation: {
      activated: true,
      bundleReady: runtimeEnabled
    },
    bundle: {
      ready: runtimeEnabled,
      tenantCode: runtimeEnabled ? 'wiztek' : null,
      deploymentCode: runtimeEnabled ? options.deploymentCode : null,
      bundleVersion: runtimeEnabled ? options.bundleVersion : null,
      bundleHash: runtimeEnabled ? options.bundleHash : null,
      error: null
    }
  }
}

function jsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  response.end(JSON.stringify(payload))
}

function startFixtureServer(routes) {
  const server = createServer((request, response) => {
    const path = String(request.url || '').split('?')[0]
    const payload = routes[path]
    if (!payload) {
      jsonResponse(response, 404, { code: 1, message: `fixture route not found: ${path}` })
      return
    }
    jsonResponse(response, 200, { code: 0, data: payload })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('fixture server did not return a TCP address'))
        return
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise(resolveClose => server.close(resolveClose))
      })
    })
  })
}

function runCommand(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs || 10000)

    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({
        code,
        signal,
        output: `${stdout}${stderr}`
      })
    })
  })
}

function assertCommandPassed(label, result) {
  if (result.code !== 0) {
    fail(`${label} should pass, got exit ${result.code ?? result.signal}\n${result.output}`)
  }
}

function assertCommandFailedWith(label, result, expectedMessages) {
  if (result.code === 0) {
    fail(`${label} should fail, but passed\n${result.output}`)
  }
  for (const message of expectedMessages) {
    if (!result.output.includes(message)) {
      fail(`${label} output must include ${JSON.stringify(message)}\n${result.output}`)
    }
  }
}

async function runFixtureGuardrails() {
  const tempDir = mkdtempSync(join(tmpdir(), 'hzy-runtime-probe-'))
  let server
  try {
    const platformProd = {
      pm2Name: 'hzy-platform-prod',
      port: 3010,
      serviceUrl: 'https://platform.wiztek.cn',
      stage: 'production',
      databaseName: 'hzy_platform',
      signingKid: 'platform-prod-key',
      publicKeyFingerprint: 'fingerprint-prod'
    }
    const platformDev = {
      pm2Name: 'hzy-platform-dev',
      port: 3011,
      serviceUrl: 'https://platform-dev.wiztek.cn',
      stage: 'test',
      databaseName: 'hzy_platform_dev',
      signingKid: 'platform-dev-key',
      publicKeyFingerprint: 'fingerprint-dev'
    }
    const platformDevCollision = {
      ...platformDev,
      pm2Name: platformProd.pm2Name,
      port: platformProd.port,
      serviceUrl: platformProd.serviceUrl,
      stage: platformProd.stage,
      publicKeyFingerprint: platformProd.publicKeyFingerprint
    }

    const consoleProd = {
      runMode: 'prod',
      platformUrl: 'https://platform.wiztek.cn',
      deploymentCode: 'wiztek-console',
      platformSigningKid: 'platform-prod-key',
      publicUrl: 'https://hzy.wiztek.cn',
      cacheDir: '.data/platform-runtime',
      authClientMode: 'upsert',
      collabMode: 'embedded',
      collabPort: 3021,
      collabDbName: 'hzy_codocs',
      authSigningKid: 'console-auth-key',
      bundleVersion: 'prod-v1',
      bundleHash: 'bundle-prod'
    }
    const consoleTest = {
      runMode: 'test',
      platformUrl: 'https://platform-dev.wiztek.cn',
      deploymentCode: 'wiztek-test-console',
      platformSigningKid: 'platform-dev-key',
      publicUrl: 'https://hzy-test.wiztek.cn',
      cacheDir: '.data/platform-runtime-test',
      authClientMode: 'append',
      collabMode: 'disabled',
      authSigningKid: 'console-auth-key',
      bundleVersion: 'test-v1',
      bundleHash: 'bundle-test'
    }
    const consoleTestCollision = {
      ...consoleTest,
      platformUrl: consoleProd.platformUrl,
      platformSigningKid: consoleProd.platformSigningKid,
      publicUrl: consoleProd.publicUrl,
      cacheDir: consoleProd.cacheDir,
      bundleHash: consoleProd.bundleHash
    }
    const consoleDev = {
      runMode: 'dev',
      runtimeEnabled: false,
      heartbeatEnabled: false,
      bundleRefreshOnBoot: false,
      authClientMaterializeEnabled: false,
      backgroundJobsEnabled: false,
      devPolicyBypass: true,
      platformUrl: '',
      deploymentCode: '',
      platformSigningKid: '',
      publicUrl: '',
      cacheDir: '.data/platform-runtime-dev',
      authClientMode: 'append',
      collabMode: 'disabled',
      authSigningKid: null,
      bundleVersion: null,
      bundleHash: null
    }

    const platformProdEnv = writeEnvFile(tempDir, 'platform-prod.env', platformEnv(platformProd))
    const platformDevEnv = writeEnvFile(tempDir, 'platform-dev.env', platformEnv(platformDev))
    const platformDevCollisionEnv = writeEnvFile(tempDir, 'platform-dev-collision.env', platformEnv(platformDevCollision))
    const consoleProdEnv = writeEnvFile(tempDir, 'console-prod.env', consoleEnv(consoleProd))
    const consoleTestEnv = writeEnvFile(tempDir, 'console-test.env', consoleEnv(consoleTest))
    const consoleTestCollisionEnv = writeEnvFile(tempDir, 'console-test-collision.env', consoleEnv(consoleTestCollision))
    const consoleDevEnv = writeEnvFile(tempDir, 'console-dev.env', consoleEnv(consoleDev))

    server = await startFixtureServer({
      '/platform-prod/api/platform/diagnostics': platformDiagnostics(platformProd),
      '/platform-dev/api/platform/diagnostics': platformDiagnostics(platformDev),
      '/platform-dev-collision/api/platform/diagnostics': platformDiagnostics(platformDevCollision),
      '/console-prod/api/activation/diagnostics': consoleDiagnostics(consoleProd),
      '/console-test/api/activation/diagnostics': consoleDiagnostics(consoleTest),
      '/console-test-collision/api/activation/diagnostics': consoleDiagnostics(consoleTestCollision),
      '/console-dev/api/activation/diagnostics': consoleDiagnostics(consoleDev)
    })

    const platformSuccess = await runCommand([
      'scripts/probe-platform-runtime.mjs',
      '--prod-url', `${server.baseUrl}/platform-prod`,
      '--dev-url', `${server.baseUrl}/platform-dev`,
      '--platform-prod-env', platformProdEnv,
      '--platform-dev-env', platformDevEnv
    ])
    assertCommandPassed('platform runtime probe fixture', platformSuccess)
    console.info('[runtime-probe-guardrails] Platform runtime probe happy-path fixture passed')

    const platformCollision = await runCommand([
      'scripts/probe-platform-runtime.mjs',
      '--prod-url', `${server.baseUrl}/platform-prod`,
      '--dev-url', `${server.baseUrl}/platform-dev-collision`,
      '--platform-prod-env', platformProdEnv,
      '--platform-dev-env', platformDevCollisionEnv
    ])
    assertCommandFailedWith('platform runtime collision fixture', platformCollision, [
      'prod/dev Platform PM2 names must be different',
      'prod/dev Platform ports must be different',
      'prod/dev Platform stages must be different',
      'prod/dev Platform serviceUrl must be different',
      'prod/dev Platform signing public key fingerprints must be different'
    ])
    console.info('[runtime-probe-guardrails] Platform runtime collision fixture rejected')

    const consoleSuccess = await runCommand([
      'scripts/probe-console-runtime.mjs',
      '--prod-url', `${server.baseUrl}/console-prod`,
      '--test-url', `${server.baseUrl}/console-test`,
      '--console-prod-env', consoleProdEnv,
      '--console-test-env', consoleTestEnv,
      '--platform-prod-env', platformProdEnv,
      '--platform-dev-env', platformDevEnv
    ])
    assertCommandPassed('console runtime probe fixture', consoleSuccess)
    console.info('[runtime-probe-guardrails] Console runtime probe happy-path fixture passed')

    const consoleDevSuccess = await runCommand([
      'scripts/probe-console-runtime.mjs',
      '--dev-url', `${server.baseUrl}/console-dev`,
      '--console-dev-env', consoleDevEnv
    ])
    assertCommandPassed('console-dev runtime-disabled probe fixture', consoleDevSuccess)
    console.info('[runtime-probe-guardrails] Console runtime-disabled dev fixture passed')

    const consoleCollision = await runCommand([
      'scripts/probe-console-runtime.mjs',
      '--prod-url', `${server.baseUrl}/console-prod`,
      '--test-url', `${server.baseUrl}/console-test-collision`,
      '--console-prod-env', consoleProdEnv,
      '--console-test-env', consoleTestCollisionEnv,
      '--platform-prod-env', platformProdEnv,
      '--platform-dev-env', platformProdEnv
    ])
    assertCommandFailedWith('console runtime collision fixture', consoleCollision, [
      'console-prod and console-test must use different Platform baseUrl',
      'console-prod and console-test must use different Platform signing kid',
      'console-prod and console-test must use different public URL',
      'console-prod and console-test file cache dirs must differ',
      'console-prod and console-test policy bundle hashes must differ'
    ])
    console.info('[runtime-probe-guardrails] Console runtime collision fixture rejected')
  } finally {
    if (server) await server.close()
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.info(usage().trim())
    return
  }

  for (const check of CHECKS) {
    const source = readSource(check.file)
    for (const needle of check.required) {
      if (!source.includes(needle)) {
        fail(`${check.description} in ${check.file} must include ${needle}`)
      }
    }
    console.info(`[runtime-probe-guardrails] ${check.description} passed`)
  }

  await runFixtureGuardrails()
  console.info('[runtime-probe-guardrails] passed')
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
