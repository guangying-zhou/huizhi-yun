#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { readProfile, validateProfile, record } from './config.mjs'
import { readCollabClientSecret } from './collab-credentials.mjs'
import { readLocalAimsClientSecret, readLocalWorkflowClientSecret } from './workflow-credentials.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    profile: { type: 'string' },
    mode: { type: 'string', default: 'dev' }
  }
})
if (!['gateway', 'enterprise', 'codocs-editor', 'console', 'collab', 'workflow', 'aims'].includes(values.app || '')) throw Error('Use --app gateway, enterprise, codocs-editor, console, collab, workflow, or aims')
if (!values.profile) throw Error('Use an absolute --profile path')
if (!['dev', 'node'].includes(values.mode)) throw Error('Use --mode dev or node')

const { value: profile } = await readProfile(values.profile)
const issues = validateProfile(profile)
if (issues.length) throw Error(`Profile is not approved:\n- ${issues.join('\n- ')}`)
if (values.mode === 'node') throw Error('Node artifact isolation and verification are not implemented; refusing to run an unverified .output')

const app = values.app
const child = app === 'gateway'
  ? startGateway(profile)
  : app === 'enterprise' ? startEnterprise(profile, values.mode)
      : app === 'console' ? startConsole(profile)
      : app === 'collab' ? startCollab(profile) : app === 'workflow' ? startWorkflow(profile) : app === 'aims' ? startAims(profile) : startCodocsEditor(profile)

const stop = signal => {
  if (!child.killed) child.kill(signal)
}
process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))
child.once('exit', code => process.exitCode = code ?? 1)
child.once('error', error => {
  console.error(`${app} failed to start: ${error.message}`)
  process.exitCode = 1
})

function startGateway(profile) {
  return spawn(process.execPath, [resolve(root, 'deploy/test-env/local-enterprise/gateway.mjs'), '--profile', values.profile], {
    // The development Platform serves `hzy-policy-revision.v1` since
    // 2026-09-22 (policy-renewal-20260922); see the policy-sync opt-in note.
    cwd: root, env: { ...processEnvironment(profile), HZY0_PROFILE_PATH: values.profile,
      HZY0_POLICY_REVISION_PROBE: 'true' }, stdio: 'inherit'
  })
}

function startCodocsEditor(profile) {
  const listener = record(profile.listeners).codocsEditor
  return spawn('wrangler', ['dev', '--config', resolve(root, 'deploy/test-env/.cloudflare-workers/codocs/wrangler.json'),
    '--local', '--ip', listener.host, '--port', String(listener.port)], {
    cwd: root,
    // The editor shell needs no Gateway or service credential. Browser APIs
    // remain on the Enterprise origin and are never forwarded to this worker.
    env: Object.fromEntries(['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL'].filter(key => process.env[key]).map(key => [key, process.env[key]])),
    stdio: 'inherit'
  })
}

function startCollab(profile) {
  if (profile.features?.codocsCollaborationV2 !== true) throw Error('Collab v2 is not enabled by the approved profile')
  const clientSecret = readCollabClientSecret(values.profile)
  const listener = profile.listeners.collab
  const inherited = Object.fromEntries(['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]))
  return spawn('pnpm', ['--dir', 'collab', 'exec', 'tsx', 'src/server.ts'], {
    cwd: root, stdio: 'inherit', env: {
      ...inherited,
      COLLAB_SERVICE_CLIENT_SECRET: clientSecret,
      DOTENV_CONFIG_PATH: '/dev/null',
      NODE_ENV: 'development', HZY_APP_RUN_MODE: 'test', HZY_PLATFORM_ENVIRONMENT: 'test',
      NODE_OPTIONS: '--network-family-autoselection-attempt-timeout=1000',
      COLLAB_RUNTIME_MODE: 'standalone', COLLAB_PROVIDER: 'hocuspocus', COLLAB_V2_ENABLED: 'true',
      COLLAB_REDIS_DISABLED: 'true', COLLAB_PORT: String(listener.port), COLLAB_ADDRESS: listener.host,
      COLLAB_PUBLIC_BASE_PATH: '/codocs/', COLLAB_SERVICE_CLIENT_ID: 'collab.runtime',
      COLLAB_CONSOLE_TOKEN_URL: `http://127.0.0.1:${profile.listeners.gatewayIngress.port}/__hzy0/collab-token`,
      COLLAB_CODOCS_RUNTIME_URL: profile.runtime.transportMode === 'loopback'
        ? profile.runtime.dialEndpoint : profile.runtime.canonicalEndpoint
    }
  })
}

function startWorkflow(profile) {
  if (profile.features?.workflowLocal !== true || profile.runtime.transportMode !== 'loopback') throw Error('Local Workflow requires the approved switch and loopback Runtime')
  const listener = profile.listeners.workflow
  const clientSecret = readLocalWorkflowClientSecret(values.profile)
  return spawn('pnpm', ['--dir', 'workflow', 'exec', 'nuxt', 'dev', '--dotenv', '/dev/null', '--host', listener.host, '--port', String(listener.port)], {
    cwd: root, stdio: 'inherit', env: {
      ...processEnvironment(profile), HZY_APP_CODE: 'workflow', NUXT_APP_BASE_URL: '/workflow/',
      HZY_DATA_ACCESS_MODE: 'tenant-runtime', HZY_WORKFLOW_DATA_ACCESS_MODE: 'tenant-runtime',
      HZY0_WORKFLOW_LOCAL_ONLY: 'true',
      HZY0_LOCAL_AIMS_URL: `http://127.0.0.1:${profile.listeners.aims.port}/aims`,
      HZY_SERVICE_CLIENT_ID: 'workflow.runtime', HZY_SERVICE_CLIENT_SECRET: clientSecret,
      HZY_TENANT_RUNTIME_URL: profile.runtime.canonicalEndpoint,
      HZY_TENANT_RUNTIME_TENANT: profile.runtime.expectedTenant,
      HZY_TENANT_RUNTIME_DEPLOYMENT: profile.runtime.expectedRuntimeDeployment,
      HZY_CONSOLE_URL: profile.identity.canonicalIssuer,
      HZY_CONSOLE_API_URL: profile.identity.canonicalIssuer,
      HZY_CONSOLE_TOKEN_URL: `${profile.identity.canonicalIssuer}/oauth/token`,
      HZY0_LOCAL_CONSOLE_FACADE: 'true',
      HZY0_CONSOLE_EGRESS_URL: `http://127.0.0.1:${profile.listeners.gatewayInternal.port}`,
      HZY_DEPLOYMENT_PUBLIC_URL: profile.publicOrigin,
      HZY_APP_HOME_URL: `${profile.publicOrigin}/workflow/`,
      NUXT_PUBLIC_RUM_ENABLED: 'false'
    }
  })
}

function startAims(profile) {
  if (profile.features?.workflowLocal !== true || profile.runtime.transportMode !== 'loopback') throw Error('Local Aims receiver requires loopback Workflow and Runtime')
  const listener = profile.listeners.aims
  const clientSecret = readLocalAimsClientSecret(root)
  return spawn('pnpm', ['--dir', 'aims', 'exec', 'nuxt', 'dev', '--dotenv', '/dev/null', '--host', listener.host, '--port', String(listener.port)], {
    cwd: root, stdio: 'inherit', env: {
      ...processEnvironment(profile), HZY_APP_CODE: 'aims', NUXT_APP_BASE_URL: '/aims/',
      HZY_DATA_ACCESS_MODE: 'tenant-runtime', HZY_AIMS_DATA_ACCESS_MODE: 'tenant-runtime',
      HZY0_WORKFLOW_LOCAL_ONLY: 'true',
      HZY_WORKFLOW_API_URL: `http://127.0.0.1:${profile.listeners.workflow.port}/workflow`,
      HZY_AIMS_SERVICE_CLIENT_ID: 'aims.runtime', HZY_AIMS_SERVICE_CLIENT_SECRET: clientSecret,
      HZY_TENANT_RUNTIME_URL: profile.runtime.canonicalEndpoint,
      HZY_TENANT_RUNTIME_TENANT: profile.runtime.expectedTenant,
      HZY_TENANT_RUNTIME_DEPLOYMENT: profile.runtime.expectedRuntimeDeployment,
      HZY_CONSOLE_URL: profile.identity.canonicalIssuer,
      HZY_CONSOLE_API_URL: profile.identity.canonicalIssuer,
      HZY_CONSOLE_TOKEN_URL: `${profile.identity.canonicalIssuer}/oauth/token`,
      HZY0_LOCAL_CONSOLE_FACADE: 'true',
      HZY0_CONSOLE_EGRESS_URL: `http://127.0.0.1:${profile.listeners.gatewayInternal.port}`,
      HZY_DEPLOYMENT_PUBLIC_URL: profile.publicOrigin,
      HZY_APP_HOME_URL: `${profile.publicOrigin}/aims/`,
      NUXT_PUBLIC_RUM_ENABLED: 'false'
    }
  })
}

function startEnterprise(profile, mode) {
  const enterprise = record(profile.listeners).enterprise
  const trust = profile.identity.policyBackend === 'verified-runtime' ? publicPolicyTrust() : null
  const env = {
    ...processEnvironment(profile),
    HZY_ENTERPRISE_PILOT: 'true',
    HZY0_LOCAL_ENTERPRISE: 'true',
    ...(profile.features?.workflowLocal === true
      ? { HZY_WORKFLOW_API_URL: `http://127.0.0.1:${profile.listeners.workflow.port}/workflow` }
      : {}),
    HZY0_NOTIFICATIONS_IN_APP_ONLY: profile.features?.notificationsInAppOnly === true ? 'true' : 'false',
    ...(trust ? { HZY_ENTERPRISE_VERIFIED_POLICY_ENABLED: 'true', HZY_ENTERPRISE_POLICY_ISSUER: 'https://hzy.wiztek.cn',
      HZY_ENTERPRISE_POLICY_KEY_ID: trust.signingKid, HZY_ENTERPRISE_POLICY_PUBLIC_KEY: trust.signingPubkey,
      HZY_ENTERPRISE_POLICY_MAX_AGE_MS: '93600000' } : {}),
    ...(profile.identity.consoleFacadeMode === 'local-canonical-facade' ? { HZY0_LOCAL_CONSOLE_FACADE: 'true' } : {}),
    HZY_DATA_ACCESS_MODE: 'tenant-runtime',
    // Codocs v2 snapshot saves for private documents; needs the Runtime switch too.
    ...(profile.features?.codocsSnapshotV2 === true ? { HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2: 'true' } : {}),
    ...(profile.features?.codocsCollaborationV2 === true ? { HZY_ENTERPRISE_CODOCS_COLLABORATION_V2: 'true' } : {}),
    ...(profile.identity.credentialProviderRef === 'protected-file:test-gateway' ? {
      HZY0_CONSOLE_EGRESS_URL: `http://127.0.0.1:${profile.listeners.gatewayInternal.port}`
    } : {}),
    HZY_DEPLOYMENT_PUBLIC_URL: profile.publicOrigin,
    HZY_APP_HOME_URL: `${profile.publicOrigin}/enterprise/`,
    // The editor shell is served under this already Access-protected origin.
    NUXT_PUBLIC_CODOCS_URL: `${profile.publicOrigin}/codocs`,
    HZY_ENTERPRISE_OIDC_REDIRECT_URI: profile.identity.enterpriseRedirectUri,
    HZY_ENTERPRISE_LOGOUT_REDIRECT_URI: profile.identity.enterpriseLogoutRedirectUri,
    HZY_CONSOLE_URL: profile.identity.canonicalIssuer,
    HZY_CONSOLE_API_URL: profile.identity.canonicalIssuer,
    HZY_CONSOLE_TOKEN_URL: `${profile.identity.canonicalIssuer}/oauth/token`,
    HZY_PLATFORM_ENVIRONMENT: 'test',
    HZY_APP_RUN_MODE: 'test',
    // The local Gateway does not expose a RUM collector. Disable the client
    // instead of generating a failing request for every page interaction.
    NUXT_PUBLIC_RUM_ENABLED: 'false',
  }
  if (mode === 'dev') {
    return spawn('pnpm', ['--dir', 'enterprise', 'exec', 'nuxt', 'dev', '--dotenv', '/dev/null', '--host', enterprise.host, '--port', String(enterprise.port)], {
      cwd: root, env, stdio: 'inherit'
    })
  }
  return spawn(process.execPath, [resolve(root, 'enterprise/.output/server/index.mjs')], {
    cwd: root, env: { ...env, NODE_ENV: 'production', HOST: enterprise.host, PORT: String(enterprise.port) }, stdio: 'inherit'
  })
}

function startConsole(profile) {
  if (profile.identity.consoleFacadeMode !== 'local-canonical-facade') throw Error('Local Console facade is not selected')
  if (profile.features?.workflowLocal === true
    && (profile.runtime.transportMode !== 'loopback' || profile.listeners.workflow.host !== '127.0.0.1')) {
    throw Error('Local Workflow Console binding requires loopback Workflow and Runtime')
  }
  const { signingKid, signingPubkey } = publicPolicyTrust()
  const verified = profile.identity.policyBackend === 'verified-runtime'
  // R1 steady service key: optional, beside the private profile, owner-only.
  const serviceKey = resolve(dirname(values.profile), 'console-service-key.pem')
  if (existsSync(serviceKey) && (statSync(serviceKey).mode & 0o077) !== 0) throw Error('Console service key must be owner-only (0600)')
  return spawn('pnpm', ['--dir', 'console', 'exec', 'nuxt', 'dev', '--dotenv', '/dev/null', '--host', '127.0.0.1', '--port', '23100'], {
    cwd: root, stdio: 'inherit', env: { ...processEnvironment(profile),
      ...(verified ? { HZY0_POLICY_EGRESS_URL: 'http://127.0.0.1:23121/__hzy0/platform-policy',
        HZY_PLATFORM_POLICY_BUNDLE_FETCH_TIMEOUT_MS: '65000' } : {}),
      ...(verified && existsSync(serviceKey) ? { HZY_CONSOLE_SERVICE_KEY_FILE: serviceKey } : {}),
      HZY0_LOCAL_CONSOLE_FACADE: 'true', HZY_APP_CODE: 'console', NUXT_APP_BASE_URL: '/console/',
      HZY0_WORKFLOW_LOCAL_ONLY: profile.features?.workflowLocal === true ? 'true' : 'false',
      ...(profile.features?.notificationsInAppOnly === true
        ? { HZY0_NOTIFICATIONS_IN_APP_ONLY: 'true' }
        : {}),
      ...(profile.features?.workflowLocal === true
        ? { HZY_CONSOLE_LOCAL_WORKFLOW_DEPLOYMENT: 'C000001-test-workflow-local' }
        : {}),
      HZY_DEPLOYMENT_PUBLIC_URL: profile.publicOrigin, HZY_APP_HOME_URL: `${profile.publicOrigin}/console/`,
      CONSOLE_OIDC_ISSUER: profile.identity.canonicalIssuer, HZY_DATA_ACCESS_MODE: 'tenant-runtime',
      HZY_CONSOLE_ACTIVATION_MODE: 'managed-cloud-multitenant', HZY_CONSOLE_TRUST_TENANT_GATEWAY: 'true',
      HZY_PLATFORM_URL: 'https://hzy.wiztek.cn', HZY_PLATFORM_SIGNING_KID: signingKid,
      HZY_PLATFORM_SIGNING_PUBKEY: signingPubkey, HZY_PLATFORM_BUNDLE_CACHE_BACKEND: verified ? 'verified-runtime' : 'runtime',
      HZY_PLATFORM_BUNDLE_MAX_AGE_MS: '93600000', HZY_PLATFORM_RUNTIME_ENABLED: 'true',
      HZY_PLATFORM_HEARTBEAT_ENABLED: 'false', HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT: 'false',
      HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE: 'false', HZY_CONSOLE_BACKGROUND_JOBS_ENABLED: 'false',
      CONSOLE_COLLAB_MODE: 'disabled', HZY_CONSOLE_PLATFORM_LIFECYCLE_SYNC_ENABLED: 'false',
      NUXT_PUBLIC_RUM_ENABLED: 'false', NUXT_VITE_ALLOWED_HOSTS: 'hzy0.isme.dev'
    }
  })
}

function publicPolicyTrust() {
  // Copy public verification material only; never the remote internal token,
  // private signing keys, DB credentials, or broad Platform credentials.
  const config = JSON.parse(readFileSync(resolve(root, 'deploy/test-env/.cloudflare-workers/console/secrets.json'), 'utf8'))
  const signingKid = config.HZY_PLATFORM_SIGNING_KID
  const signingPubkey = config.HZY_PLATFORM_SIGNING_PUBKEY
  if (!signingKid || !signingPubkey?.includes('PUBLIC KEY') || signingPubkey.includes('PRIVATE')) throw Error('Platform verification key unavailable')
  return { signingKid, signingPubkey }
}

function processEnvironment(profile) {
  const inherited = {}
  for (const key of ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (process.env[key]) inherited[key] = process.env[key]
  }
  return {
    ...inherited,
    NODE_ENV: 'development',
    HZY_APP_RUN_MODE: 'test',
    HZY_PLATFORM_ENVIRONMENT: 'test',
    HZY_DEV_APPLICATIONS_ENABLED: 'false',
    HZY_LOCAL_DEV_APPLICATIONS_ENABLED: 'false',
    HZY_LOCAL_DEV_RUNTIME_BYPASS: 'false',
    HZY_DEV_RUNTIME_BYPASS: 'false',
    HZY_CONSOLE_DEV_POLICY_BYPASS: 'false',
    CONSOLE_DEV_POLICY_BYPASS: 'false',
    HZY_AUTH_COOKIE_HOST_ONLY: 'true',
    // This Mac has no IPv6 route, so Happy Eyeballs leaves IPv4 as the only
    // candidate. Node's default 250 ms attempt budget then aborts slow-but-valid
    // Cloudflare handshakes with ETIMEDOUT (~260 ms), surfacing as auth 503s.
    NODE_OPTIONS: '--network-family-autoselection-attempt-timeout=1000',
    HZY0_GATEWAY_INTERNAL_TOKEN: process.env.HZY0_GATEWAY_INTERNAL_TOKEN || '',
    HZY_CLOUDFLARE_INTERNAL_TOKEN: process.env.HZY0_GATEWAY_INTERNAL_TOKEN || '',
    HZY0_PROFILE_PATH: profile.profileId
  }
}
