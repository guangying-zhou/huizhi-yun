#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import process from 'node:process'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
  LocalProcessGroupConfigurationError,
  buildLocalProcessGroupPlan,
  withLocalProcessGroup
} from './test/support/local-process-group-supervisor.mjs'

export const G3_PROCESS_ORDER = Object.freeze([
  'aims-data-runtime',
  'altoc-data-runtime',
  'console',
  'aims',
  'altoc',
  'https-tenant-gateway'
])

export const G3_REQUIRED_ENVIRONMENT = Object.freeze([
  'HZY_G3_DATA_RUNTIME_BINARY_SHA256',
  'HZY_G3_CONSOLE_SEED_SHA256',
  'HZY_G3_AIMS_SEED_SHA256',
  'HZY_G3_ALTOC_SEED_SHA256',
  'HZY_G3_CONSOLE_DB_HOST',
  'HZY_G3_CONSOLE_DB_PORT',
  'HZY_G3_CONSOLE_DB_USER',
  'HZY_G3_CONSOLE_DB_PASSWORD',
  'HZY_G3_CONSOLE_DB_NAME',
  'HZY_G3_AIMS_DB_HOST',
  'HZY_G3_AIMS_DB_PORT',
  'HZY_G3_AIMS_DB_USER',
  'HZY_G3_AIMS_DB_PASSWORD',
  'HZY_G3_AIMS_DB_NAME',
  'HZY_G3_ALTOC_DB_HOST',
  'HZY_G3_ALTOC_DB_PORT',
  'HZY_G3_ALTOC_DB_USER',
  'HZY_G3_ALTOC_DB_PASSWORD',
  'HZY_G3_ALTOC_DB_NAME',
  'HZY_G3_AIMS_SERVICE_CLIENT_ID',
  'HZY_G3_AIMS_SERVICE_CLIENT_SECRET',
  'HZY_G3_ALTOC_SERVICE_CLIENT_ID',
  'HZY_G3_ALTOC_SERVICE_CLIENT_SECRET',
  'HZY_G3_GATEWAY_INTERNAL_TOKEN'
])

const SHA256_PATTERN = /^[a-f0-9]{64}$/i
const CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

function usage() {
  return `Usage (contract preview by default; starts no process):
  pnpm run harness:g3-real-http -- --manifest <g3-real-http.json>

Execute only when preview reports ready and after reviewing its exact digest:
  pnpm run harness:g3-real-http -- --manifest <g3-real-http.json> \\
    --execute --confirm <confirmation-sha256>

The harness never reads .env or .env.dev. All credentials come from the fixed
HZY_G3_* environment contract, and all CA/TLS/runtime artifacts are explicit
workspace paths. Preview reports missing inputs without printing their values.
Readiness proves only local process HTTP availability, not a G3 business flow.`
}

function stringValue(value) {
  return String(value ?? '').trim()
}

function workspacePath(rootDir, input, label) {
  const absolute = resolve(rootDir, stringValue(input))
  const rel = relative(rootDir, absolute)
  if (!input || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new LocalProcessGroupConfigurationError(`${label} must be an explicit path inside the workspace`)
  }
  return absolute
}

function integer(value, label) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1024 || number > 65535) {
    throw new LocalProcessGroupConfigurationError(`${label} must be an unprivileged TCP port`)
  }
  return number
}

function code(value, label) {
  const normalized = stringValue(value)
  if (!CODE_PATTERN.test(normalized)) throw new LocalProcessGroupConfigurationError(`${label} is invalid`)
  return normalized
}

function parseArgs(argv) {
  const result = { manifest: '', execute: false, confirm: '', help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (raw === '--') continue
    if (raw === '--help' || raw === '-h') { result.help = true; continue }
    if (raw === '--execute') { result.execute = true; continue }
    const match = /^--(manifest|confirm)(?:=(.*))?$/.exec(raw)
    if (!match) throw new LocalProcessGroupConfigurationError(`unexpected argument: ${raw}`)
    const value = match[2] ?? argv[++index]
    if (!value || value.startsWith('--')) throw new LocalProcessGroupConfigurationError(`missing value for --${match[1]}`)
    result[match[1]] = value
  }
  return result
}

async function fileState(path, executable = false) {
  try {
    await access(path, executable ? fsConstants.X_OK : fsConstants.R_OK)
    const info = await stat(path)
    return info.isFile()
  } catch {
    return false
  }
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function externalEnvironment(environment) {
  const values = {}
  const missing = []
  for (const name of G3_REQUIRED_ENVIRONMENT) {
    const value = stringValue(environment[name])
    if (!value) missing.push(`env:${name}`)
    else values[name] = value
  }
  for (const name of ['HZY_G3_DATA_RUNTIME_BINARY_SHA256', 'HZY_G3_CONSOLE_SEED_SHA256', 'HZY_G3_AIMS_SEED_SHA256', 'HZY_G3_ALTOC_SEED_SHA256']) {
    if (values[name] && !SHA256_PATTERN.test(values[name])) {
      throw new LocalProcessGroupConfigurationError(`${name} must be a SHA-256 digest`)
    }
  }
  for (const app of ['CONSOLE', 'AIMS', 'ALTOC']) {
    const host = values[`HZY_G3_${app}_DB_HOST`]
    if (host && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
      throw new LocalProcessGroupConfigurationError(`HZY_G3_${app}_DB_HOST must be loopback`)
    }
    const port = values[`HZY_G3_${app}_DB_PORT`]
    if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
      throw new LocalProcessGroupConfigurationError(`HZY_G3_${app}_DB_PORT must be a TCP port`)
    }
    const expectedName = `hzy_${app.toLowerCase()}`
    if (values[`HZY_G3_${app}_DB_NAME`] && values[`HZY_G3_${app}_DB_NAME`] !== expectedName) {
      throw new LocalProcessGroupConfigurationError(`HZY_G3_${app}_DB_NAME must equal ${expectedName}`)
    }
  }
  return { values, missing }
}

function runtimeEnvironment({ app, port, tenant, deployment, db, values, issuer, jwksUrl, binarySha256 }) {
  const prefix = app.toUpperCase()
  return {
    HZY_DATA_RUNTIME_HOST: '127.0.0.1',
    HZY_DATA_RUNTIME_PORT: String(port),
    HZY_DATA_RUNTIME_TENANT: tenant,
    HZY_DATA_RUNTIME_DEPLOYMENT: deployment,
    HZY_DATA_RUNTIME_AUTH_MODE: 'jwt',
    HZY_DATA_RUNTIME_JWT_ISSUER: issuer,
    HZY_DATA_RUNTIME_JWT_AUDIENCE: 'data-runtime',
    HZY_DATA_RUNTIME_JWKS_URL: jwksUrl,
    HZY_FINANCE_AGENT_ENABLED: 'false',
    HZY_AIMS_AGENT_ENABLED: app === 'aims' ? 'true' : 'false',
    HZY_ALTOC_AGENT_ENABLED: app === 'altoc' ? 'true' : 'false',
    [`HZY_${prefix}_DB_HOST`]: values[`HZY_G3_${prefix}_DB_HOST`],
    [`HZY_${prefix}_DB_PORT`]: values[`HZY_G3_${prefix}_DB_PORT`],
    [`HZY_${prefix}_DB_USER`]: values[`HZY_G3_${prefix}_DB_USER`],
    [`HZY_${prefix}_DB_PASSWORD`]: values[`HZY_G3_${prefix}_DB_PASSWORD`],
    [`HZY_${prefix}_DB_NAME`]: values[`HZY_G3_${prefix}_DB_NAME`],
    HZY_G3_SCHEMA_SEED_SHA256: values[`HZY_G3_${prefix}_SEED_SHA256`],
    HZY_G3_RUNTIME_BINARY_SHA256: binarySha256
  }
}

function appEnvironment({ app, port, tenant, appDeployment, runtimeDeployment, runtimeUrl, gatewayUrl, values }) {
  const prefix = app.toUpperCase()
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: String(port),
    HZY_APP_CODE: app,
    HZY_DEPLOYMENT_PROFILE: 'managed-cloud-agent',
    HZY_DEPLOYMENT_ENVIRONMENT: 'test',
    HZY_DEPLOYMENT_PUBLIC_URL: gatewayUrl,
    HZY_PLATFORM_TENANT_CODE: tenant,
    HZY_PLATFORM_DEPLOYMENT_CODE: appDeployment,
    HZY_CONSOLE_URL: gatewayUrl,
    HZY_CONSOLE_TOKEN_URL: `${gatewayUrl}/oauth/token`,
    HZY_CONSOLE_RUNTIME_ENABLED: 'true',
    HZY_CLOUDFLARE_INTERNAL_TOKEN: values.HZY_G3_GATEWAY_INTERNAL_TOKEN,
    HZY_DATA_ACCESS_MODE: 'tenant-runtime',
    HZY_TENANT_RUNTIME_URL: runtimeUrl,
    HZY_TENANT_RUNTIME_AUDIENCE: 'data-runtime',
    HZY_TENANT_RUNTIME_TENANT: tenant,
    HZY_TENANT_RUNTIME_DEPLOYMENT: runtimeDeployment,
    HZY_SERVICE_CLIENT_ID: values[`HZY_G3_${prefix}_SERVICE_CLIENT_ID`],
    HZY_SERVICE_CLIENT_SECRET: values[`HZY_G3_${prefix}_SERVICE_CLIENT_SECRET`]
  }
}

export async function buildG3RealHttpContract(manifest, options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd())
  if (manifest?.schemaVersion !== 1 || manifest?.kind !== 'hzy-g3-real-http') {
    throw new LocalProcessGroupConfigurationError('manifest must declare schemaVersion=1 and kind=hzy-g3-real-http')
  }
  const tenant = code(manifest.tenant, 'tenant')
  const deployments = {
    console: code(manifest.deployments?.console, 'deployments.console'),
    aimsApp: code(manifest.deployments?.aimsApp, 'deployments.aimsApp'),
    altocApp: code(manifest.deployments?.altocApp, 'deployments.altocApp'),
    aimsRuntime: code(manifest.deployments?.aimsRuntime, 'deployments.aimsRuntime'),
    altocRuntime: code(manifest.deployments?.altocRuntime, 'deployments.altocRuntime')
  }
  if (new Set(Object.values(deployments)).size !== Object.values(deployments).length) {
    throw new LocalProcessGroupConfigurationError('all app/runtime deployment codes must be distinct')
  }
  const ports = Object.fromEntries(Object.entries(manifest.ports || {}).map(([key, value]) => [key, integer(value, `ports.${key}`)]))
  for (const key of ['aimsRuntime', 'altocRuntime', 'console', 'aims', 'altoc', 'gateway']) {
    if (!ports[key]) throw new LocalProcessGroupConfigurationError(`ports.${key} is required`)
  }
  if (new Set(Object.values(ports)).size !== 6) throw new LocalProcessGroupConfigurationError('all six process ports must be distinct')

  const artifacts = {
    dataRuntimeBinary: workspacePath(rootDir, manifest.artifacts?.dataRuntimeBinary, 'artifacts.dataRuntimeBinary'),
    caCertificate: workspacePath(rootDir, manifest.artifacts?.caCertificate, 'artifacts.caCertificate'),
    gatewayCertificate: workspacePath(rootDir, manifest.artifacts?.gatewayCertificate, 'artifacts.gatewayCertificate'),
    gatewayPrivateKey: workspacePath(rootDir, manifest.artifacts?.gatewayPrivateKey, 'artifacts.gatewayPrivateKey'),
    explicitDotenv: workspacePath(rootDir, manifest.artifacts?.explicitDotenv, 'artifacts.explicitDotenv'),
    runtimeCwd: workspacePath(rootDir, manifest.artifacts?.runtimeCwd, 'artifacts.runtimeCwd')
  }
  const artifactChecks = [
    ['dataRuntimeBinary', true],
    ['caCertificate', false],
    ['gatewayCertificate', false],
    ['gatewayPrivateKey', false],
    ['explicitDotenv', false]
  ]
  const missing = []
  for (const [name, executable] of artifactChecks) {
    if (!await fileState(artifacts[name], executable)) missing.push(`artifact:${name}`)
  }
  try {
    if (!(await stat(artifacts.runtimeCwd)).isDirectory()) missing.push('artifact:runtimeCwd')
  } catch { missing.push('artifact:runtimeCwd') }
  for (const hiddenEnv of ['.env', '.env.dev']) {
    if (await fileState(resolve(artifacts.runtimeCwd, hiddenEnv))) {
      throw new LocalProcessGroupConfigurationError(`runtimeCwd must not contain ${hiddenEnv}`)
    }
  }
  if (await fileState(artifacts.gatewayPrivateKey)) {
    const mode = (await stat(artifacts.gatewayPrivateKey)).mode & 0o777
    if ((mode & 0o077) !== 0) throw new LocalProcessGroupConfigurationError('gatewayPrivateKey must not be group/world accessible')
  }

  const external = externalEnvironment(options.environment || process.env)
  missing.push(...external.missing)
  if (!missing.includes('artifact:dataRuntimeBinary') && external.values.HZY_G3_DATA_RUNTIME_BINARY_SHA256) {
    const actual = await sha256File(artifacts.dataRuntimeBinary)
    if (actual !== external.values.HZY_G3_DATA_RUNTIME_BINARY_SHA256.toLowerCase()) {
      throw new LocalProcessGroupConfigurationError('data-runtime binary digest does not match HZY_G3_DATA_RUNTIME_BINARY_SHA256')
    }
  }

  const gatewayUrl = `https://127.0.0.1:${ports.gateway}`
  const consoleUrl = `http://127.0.0.1:${ports.console}`
  const aimsRuntimeUrl = `http://127.0.0.1:${ports.aimsRuntime}`
  const altocRuntimeUrl = `http://127.0.0.1:${ports.altocRuntime}`
  const values = external.values
  const requirements = {
    processOrder: [...G3_PROCESS_ORDER],
    readinessScope: 'process-http-only',
    noDotenvDiscovery: true,
    externalEnvironment: [...G3_REQUIRED_ENVIRONMENT],
    externalArtifacts: Object.keys(artifacts),
    databaseSeedReceipts: ['HZY_G3_CONSOLE_SEED_SHA256', 'HZY_G3_AIMS_SEED_SHA256', 'HZY_G3_ALTOC_SEED_SHA256'],
    missing: [...new Set(missing)].sort()
  }
  if (requirements.missing.length) return { ready: false, requirements, processes: [] }

  const commonAppArgs = app => ['exec', 'nuxi', 'dev', '--dotenv', artifacts.explicitDotenv, '--host', '127.0.0.1', '--port', String(ports[app])]
  const binarySha256 = values.HZY_G3_DATA_RUNTIME_BINARY_SHA256.toLowerCase()
  const processes = [
    {
      name: 'aims-data-runtime', command: artifacts.dataRuntimeBinary, args: [], cwd: artifacts.runtimeCwd,
      env: runtimeEnvironment({ app: 'aims', port: ports.aimsRuntime, tenant, deployment: deployments.aimsRuntime, values, issuer: gatewayUrl, jwksUrl: `${consoleUrl}/.well-known/jwks.json`, binarySha256 }),
      readiness: { url: `${aimsRuntimeUrl}/runtime/healthz`, status: 200 }
    },
    {
      name: 'altoc-data-runtime', command: artifacts.dataRuntimeBinary, args: [], cwd: artifacts.runtimeCwd,
      env: runtimeEnvironment({ app: 'altoc', port: ports.altocRuntime, tenant, deployment: deployments.altocRuntime, values, issuer: gatewayUrl, jwksUrl: `${consoleUrl}/.well-known/jwks.json`, binarySha256 }),
      readiness: { url: `${altocRuntimeUrl}/runtime/healthz`, status: 200 }
    },
    {
      name: 'console', command: 'pnpm', args: commonAppArgs('console'), cwd: resolve(rootDir, 'console'),
      env: {
        NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(ports.console), NITRO_HOST: '127.0.0.1', NITRO_PORT: String(ports.console),
        HZY_APP_CODE: 'console', HZY_DEPLOYMENT_PROFILE: 'managed-cloud-agent', HZY_DEPLOYMENT_ENVIRONMENT: 'test', HZY_DEPLOYMENT_PUBLIC_URL: gatewayUrl,
        HZY_PLATFORM_TENANT_CODE: tenant, HZY_PLATFORM_DEPLOYMENT_CODE: deployments.console, HZY_PLATFORM_RUNTIME_ENABLED: 'false',
        HZY_CONSOLE_RUN_MODE: 'test', HZY_CONSOLE_BACKGROUND_JOBS_ENABLED: 'false', CONSOLE_COLLAB_MODE: 'disabled', CONSOLE_OIDC_ISSUER: gatewayUrl,
        HZY_CLOUDFLARE_INTERNAL_TOKEN: values.HZY_G3_GATEWAY_INTERNAL_TOKEN,
        DB_HOST: values.HZY_G3_CONSOLE_DB_HOST, DB_PORT: values.HZY_G3_CONSOLE_DB_PORT, DB_USER: values.HZY_G3_CONSOLE_DB_USER,
        DB_PASSWORD: values.HZY_G3_CONSOLE_DB_PASSWORD, DB_NAME: values.HZY_G3_CONSOLE_DB_NAME,
        HZY_G3_SCHEMA_SEED_SHA256: values.HZY_G3_CONSOLE_SEED_SHA256
      },
      readiness: { url: `${consoleUrl}/`, status: 200 }
    },
    {
      name: 'aims', command: 'pnpm', args: commonAppArgs('aims'), cwd: resolve(rootDir, 'aims'),
      env: appEnvironment({ app: 'aims', port: ports.aims, tenant, appDeployment: deployments.aimsApp, runtimeDeployment: deployments.aimsRuntime, runtimeUrl: aimsRuntimeUrl, gatewayUrl, values }),
      readiness: { url: `http://127.0.0.1:${ports.aims}/aims/`, status: 200 }
    },
    {
      name: 'altoc', command: 'pnpm', args: commonAppArgs('altoc'), cwd: resolve(rootDir, 'altoc'),
      env: appEnvironment({ app: 'altoc', port: ports.altoc, tenant, appDeployment: deployments.altocApp, runtimeDeployment: deployments.altocRuntime, runtimeUrl: altocRuntimeUrl, gatewayUrl, values }),
      readiness: { url: `http://127.0.0.1:${ports.altoc}/altoc/`, status: 200 }
    },
    {
      name: 'https-tenant-gateway', command: 'node', args: ['scripts/test/support/local-tenant-gateway-server.mjs'], cwd: rootDir,
      env: {
        HZY_G3_GATEWAY_HOST: '127.0.0.1', HZY_G3_GATEWAY_PORT: String(ports.gateway),
        HZY_G3_GATEWAY_CERTIFICATE_FILE: artifacts.gatewayCertificate, HZY_G3_GATEWAY_PRIVATE_KEY_FILE: artifacts.gatewayPrivateKey,
        HZY_CLOUDFLARE_INTERNAL_TOKEN: values.HZY_G3_GATEWAY_INTERNAL_TOKEN,
        HZY_DEFAULT_TENANT: tenant, HZY_ALLOWED_TENANTS: tenant, HZY_TENANT_DOMAIN_SUFFIX: 'local.test',
        HZY_CONSOLE_ORIGIN: consoleUrl, HZY_AIMS_ORIGIN: `http://127.0.0.1:${ports.aims}`, HZY_ALTOC_ORIGIN: `http://127.0.0.1:${ports.altoc}`,
        HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { '127.0.0.1': { tenantCode: tenant, deploymentCode: deployments.console, environment: 'test', apps: { aims: { deploymentCode: deployments.aimsApp, dataRuntime: { endpoint: aimsRuntimeUrl, audience: 'data-runtime' } }, altoc: { deploymentCode: deployments.altocApp, dataRuntime: { endpoint: altocRuntimeUrl, audience: 'data-runtime' } } } } } })
      },
      readiness: { url: `${gatewayUrl}/`, status: 200 }
    }
  ]
  return { ready: true, requirements, processes, caFile: artifacts.caCertificate }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help) { console.info(usage()); return 0 }
  if (!args.manifest) throw new LocalProcessGroupConfigurationError('--manifest is required')
  const rootDir = process.cwd()
  const manifestPath = workspacePath(rootDir, args.manifest, 'manifest')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const contract = await buildG3RealHttpContract(manifest, { rootDir })
  console.info(`[g3-real-http] mode=${args.execute ? 'execute' : 'preview'} order=${contract.requirements.processOrder.join('>')}`)
  console.info(`[g3-real-http] readiness=${contract.requirements.readinessScope} dotenvDiscovery=false`)
  if (!contract.ready) {
    console.info(`[g3-real-http] blocked=${contract.requirements.missing.join(',')}`)
    if (args.execute) throw new LocalProcessGroupConfigurationError('G3 real HTTP contract has missing external inputs')
    console.info('[g3-real-http] preview incomplete; no confirmation digest and no process start.')
    return 0
  }
  const allowedEnvironment = [...new Set(contract.processes.flatMap(item => Object.keys(item.env)))].sort()
  const plan = await buildLocalProcessGroupPlan({ rootDir, allowedWorkingRoots: [rootDir], allowedFileRoots: [rootDir], allowedEnvironment, caFile: contract.caFile, totalTimeoutMs: manifest.totalTimeoutMs || 180000, pollMs: manifest.pollMs || 250, processes: contract.processes })
  for (const [index, item] of plan.processes.entries()) console.info(`[g3-real-http] ${index + 1}. ${item.name} ${item.readiness.url}->${item.readiness.status}`)
  console.info(`[g3-real-http] confirmationSha256=${plan.confirmationSha256}`)
  if (!args.execute) return 0
  await withLocalProcessGroup(plan, async () => undefined, { execute: true, confirm: args.confirm })
  console.info('[g3-real-http] local process readiness complete; no business acceptance was executed.')
  return 0
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().then(code => { process.exitCode = code }, error => { console.error(`[g3-real-http] ${error.message}`); process.exitCode = 1 })
}
