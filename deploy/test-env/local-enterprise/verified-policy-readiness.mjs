// Read-only, pinned hzy0 preflight. No migrations, process control or raw secrets.
import { readFileSync, statSync } from 'node:fs'
import { createPublicKey } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { validateProfile } from './config.mjs'

const runtimeDirectory = '/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime'
const profilePath = '/Users/gavinzhou/.config/huizhi-yun/hzy0/profile.json'
const root = fileURLToPath(new URL('../../../', import.meta.url))

function protectedJson(path) {
  const info = statSync(path)
  if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077)) throw Error('unsafe_configuration')
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function validateReadinessTarget(profile, config) {
  if (validateProfile(profile).length || profile.identity.consoleFacadeMode !== 'local-canonical-facade'
    || config.tenant !== 'C000001' || config.deployment !== 'c000001-test-tenant-runtime'
    || config.server?.host !== '127.0.0.1' || config.server?.port !== 18084
    || config.apps?.console?.db?.host !== '127.0.0.1' || config.apps.console.db.port !== 3306
    || config.apps.console.db.database !== 'hzy_console_test_local_20260910'
    || config.control?.platformUrl !== 'https://hzy.wiztek.cn'
    || config.control.runtimeCode !== 'c000001-test-tenant-runtime'
    || config.deploymentBindings?.console !== 'wiztek-test-console'
    || config.deploymentBindings?.enterprise !== 'C000001-test-enterprise'
    || config.auth?.mode !== 'jwt') throw Error('readiness_target_mismatch')
}

export function sameVerificationKey(overlay, consoleConfig) {
  if (overlay.alg !== 'Ed25519' || overlay.kid !== consoleConfig.HZY_PLATFORM_SIGNING_KID) return false
  try {
    const publicKey = value => {
      const key = createPublicKey(value)
      if (key.asymmetricKeyType !== 'ed25519') throw Error('invalid_key_algorithm')
      return key.export({ format: 'der', type: 'spki' })
    }
    return publicKey(overlay.publicKey).equals(publicKey(consoleConfig.HZY_PLATFORM_SIGNING_PUBKEY))
  } catch { return false }
}

export async function inspectLocalReadiness({ query, health, config, keyMatches }) {
  const [tables] = await query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('verified_policy_snapshots','policy_bundle_snapshots')")
  const [grants] = await query(`SELECT c.client_code AS client, c.status AS clientStatus,
    k.status AS credentialStatus, g.action, g.status AS grantStatus
    FROM service_clients c LEFT JOIN service_client_credentials k ON k.id=c.current_credential_id AND k.service_client_id=c.id
    LEFT JOIN service_client_grants g ON g.service_client_id=c.id AND g.resource_code='console:policy-bundle'
    WHERE (c.client_code='console.runtime' AND c.app_code='console') OR (c.client_code='enterprise.runtime' AND c.app_code='enterprise')`)
  const active = (client, action) => grants.some(row => row.client === client && row.action === action
    && row.clientStatus === 'active' && row.credentialStatus === 'active' && row.grantStatus === 'active')
  return {
    observedAt: new Date().toISOString(), acceptancePassed: false,
    runtime: { version: health.version, commit: health.commit, builtAt: health.builtAt,
      policyEnabled: config.apps.console.policyEnvelope?.enabled === true,
      enterpriseReaderEnabled: config.apps.console.policyEnvelope?.enterpriseReadEnabled === true,
      verificationKeyMatchesConsole: keyMatches },
    schema: { verifiedTable: tables.some(row => row.name === 'verified_policy_snapshots'), legacyTable: tables.some(row => row.name === 'policy_bundle_snapshots') },
    grants: { consoleRead: active('console.runtime', 'read'), consoleWrite: active('console.runtime', 'write'),
      enterpriseRead: active('enterprise.runtime', 'read'), enterpriseWrite: active('enterprise.runtime', 'write') },
    // Database grants are not evidence of real token issuance, nor of a deployed
    // Platform format. Keep unknown prerequisites explicit, never "ready:true".
    remaining: ['all_selected_callers_token_probes', 'deployed_platform_format', 'fresh_envelope_dual_deployment_coverage',
      'approved_sync_transport_and_cadence', 'local_runner_selection', 'browser_login_navigation']
  }
}

export async function probePolicyServices({ request, bootstrap, platformToken }) {
  const tokenResults = []
  let runtimeReadStatus = null
  const checkedRequest = async (stage, url, options) => {
    try { return await request(url, options) } catch {
      throw Object.assign(Error('service_probe_unavailable'), { probeStage: stage, tokenResults, runtimeReadStatus })
    }
  }
  let readToken
  for (const audience of ['data-runtime', 'tenant-runtime']) {
    for (const scope of ['console:policy-bundle:read', 'console:policy-bundle:write', 'console:policy-bundle:read console:policy-bundle:write']) {
      const response = await checkedRequest('runtime_token_issuance', 'https://hzy-test-runtime.isme.dev/v1/console/auth/service-tokens/issue', {
        method: 'POST', headers: { authorization: `Bearer ${bootstrap}`, 'content-type': 'application/json' },
        body: JSON.stringify({ audience, scope, issuer: 'https://hzy-test.huizhi.yun', ttlSeconds: 60,
          sourceBinding: 'service-client-policy', policyVersion: null, caps: null })
      })
      const body = await response.json().catch(() => null)
      const issued = response.ok && typeof body?.data?.accessToken === 'string' && body.data.accessToken.length > 0
      tokenResults.push({ audience, scope, status: response.status, issued })
      if (issued && audience === 'data-runtime' && scope === 'console:policy-bundle:read') readToken = body.data.accessToken
    }
  }
  if (readToken) {
    const response = await checkedRequest('runtime_verified_read', 'https://hzy-test-runtime.isme.dev/v1/console/verified-policy', { headers: { authorization: `Bearer ${readToken}` } })
    runtimeReadStatus = response.status
    await response.body?.cancel()
  }
  // A fixed nonempty version is essential: the legacy GET may GENERATE a
  // bundle on cache miss without it. New code rejects any historical selection
  // before signing. This only detects the route contract, not fresh delivery.
  const query = new URLSearchParams({ environment: 'test', deploymentCode: 'wiztek-test-console',
    format: 'hzy-policy-envelope.v1', version: 'hzy0-readiness-no-generation' })
  const response = await checkedRequest('platform_format_guard', `https://hzy.wiztek.cn/api/platform/internal/console/tenants/C000001/bundle?${query}`, {
    headers: { authorization: `Bearer ${platformToken}`, 'x-hzy-internal-principal': 'hzy0-policy-readiness' }
  })
  const body = await response.json().catch(() => null)
  const message = body?.message || body?.data?.message || body?.statusMessage || ''
  return { tokenResults, runtimeReadStatus, platform: { status: response.status,
    newFormatGuardObserved: response.status === 400 && message === 'Historical policy envelopes cannot be renewed',
    legacyLookupObserved: response.status === 404 && /^bundle not found:/.test(message),
    freshDeliveryVerified: false } }
}

async function main() {
  const serviceProbes = process.argv[3] === '--service-probes'
  if (process.argv[2] !== '--live-read' || process.argv.length !== (serviceProbes ? 4 : 3)) throw Error('explicit_live_read_required')
  const profile = protectedJson(profilePath)
  const config = protectedJson(`${runtimeDirectory}/config.json`)
  validateReadinessTarget(profile, config)
  const overlay = protectedJson(`${runtimeDirectory}/platform-signing-key.json`)
  const consoleConfig = protectedJson(`${root}/deploy/test-env/.cloudflare-workers/console/secrets.json`)
  const response = await fetch('http://127.0.0.1:18084/runtime/healthz', { redirect: 'error', signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw Error('runtime_unavailable')
  const health = await response.json()
  if (health.tenant !== config.tenant || health.deployment !== config.deployment || health.status !== 'ok') throw Error('runtime_binding_mismatch')
  const require = createRequire(new URL('../../../platform/package.json', import.meta.url))
  const mysql = require('mysql2/promise')
  const { host, port, user, password, database } = config.apps.console.db
  const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 5000, multipleStatements: false })
  let result
  try {
    await connection.query('START TRANSACTION READ ONLY')
    result = await inspectLocalReadiness({ query: sql => connection.query(sql), health, config, keyMatches: sameVerificationKey(overlay, consoleConfig) })
  } finally {
    await connection.rollback()
    await connection.end()
  }
  if (serviceProbes) {
    const credentials = protectedJson(`${root}/deploy/test-env/.cloudflare-workers/gateway/secrets.json`)
    const vars = JSON.parse(readFileSync(`${root}/deploy/test-env/.cloudflare-workers/gateway/wrangler.json`, 'utf8')).vars
    const tenant = JSON.parse(credentials.HZY_TENANT_GATEWAY_REGISTRY_JSON).domains['hzy-test.huizhi.yun']
    if (tenant.tenantCode !== config.tenant || tenant.environment !== 'test'
      || tenant.apps?.console?.deploymentCode !== config.deploymentBindings.console
      || tenant.dataRuntime?.endpoint !== 'https://hzy-test-runtime.isme.dev'
      || !credentials.HZY_PLATFORM_INTERNAL_TOKEN) throw Error('probe_binding_mismatch')
    const request = (url, options = {}) => fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) })
    const { resolveRuntimeBootstrapToken } = await import('../../cloudflare/tenant-gateway/src/index.js')
    try {
      const bootstrap = await resolveRuntimeBootstrapToken({ ...vars, ...credentials }, tenant, request)
      result.services = await probePolicyServices({ request, bootstrap, platformToken: credentials.HZY_PLATFORM_INTERNAL_TOKEN })
    } catch (error) {
      result.services = { error: 'service_probe_unavailable', stage: error.probeStage || 'platform_bootstrap',
        tokenResults: error.tokenResults || [], runtimeReadStatus: error.runtimeReadStatus ?? null }
      process.exitCode = 1
    }
  }
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Verified policy preflight failed; sensitive details suppressed'); process.exitCode = 1 })
}
