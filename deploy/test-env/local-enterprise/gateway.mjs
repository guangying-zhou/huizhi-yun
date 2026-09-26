#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { readProfile, validateProfile } from './config.mjs'
import { createLocalEnterpriseGateway } from './gateway-transport.mjs'
import { createConsoleEgress } from './console-egress.mjs'
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createConsoleFacade } from './console-facade.mjs'
import { POLICY_FAULTS, createPolicyDelivery, createPolicyWake, startPolicySync } from './policy-sync.mjs'
import { runtimeDialEndpoint, verifyRuntimeTransport } from './runtime-transport.mjs'

const { values } = parseArgs({ options: { profile: { type: 'string' } } })
if (!values.profile) throw Error('Use an absolute --profile path')
const { value: profile } = await readProfile(values.profile)
const issues = validateProfile(profile)
if (issues.length) throw Error('Profile is not approved:\n- ' + issues.join('\n- '))
// Fail closed before any listener or scheduler starts. The canonical/public
// identity remains pinned in the registry; only the local HTTP dial changes.
const dialEndpoint = runtimeDialEndpoint(profile.runtime)
await verifyRuntimeTransport(profile)
const secret = String(process.env.HZY0_GATEWAY_INTERNAL_TOKEN || '').trim()
if (!secret) throw Error('HZY0_GATEWAY_INTERNAL_TOKEN must be supplied by the approved credential provider.')

let egress, facade, stopPolicySync
if (profile.identity.credentialProviderRef === 'protected-file:test-gateway') {
  const path = resolve(import.meta.dirname, '../.cloudflare-workers/gateway/secrets.json')
  const info = await stat(path)
  if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077)) throw Error('Unsafe credential provider permissions')
  const credentials = JSON.parse(await readFile(path, 'utf8'))
  const registry = JSON.parse(credentials.HZY_TENANT_GATEWAY_REGISTRY_JSON || '{}')
  const tenant = registry.domains?.['hzy-test.huizhi.yun']
  if (tenant?.tenantCode !== 'C000001' || tenant.environment !== 'test'
    || tenant.apps?.console?.deploymentCode !== 'wiztek-test-console'
    || profile.identity.enterpriseDeployment !== 'C000001-test-enterprise') throw Error('Egress identity mismatch')
  const remoteSecret = credentials.HZY_CLOUDFLARE_INTERNAL_TOKEN || credentials.HZY_TENANT_GATEWAY_INTERNAL_TOKEN
  // Acceptance switch beside the private profile; absent means normal.
  const policyFault = () => {
    try {
      const value = readFileSync(resolve(dirname(values.profile), 'policy-sync-fault'), 'utf8').trim()
      return POLICY_FAULTS.has(value) ? value : null
    } catch { return null }
  }
  const digest = await fetch('https://hzy-test.huizhi.yun/__test/registry-digest', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${remoteSecret}` }
  })
  const live = digest.ok ? await digest.json() : null
  if (live?.schema !== 'test-registry-digest.v1' || live.tenant !== 'C000001' || live.environment !== 'test'
    || live.enterpriseDeployment !== 'C000001-test-enterprise') throw Error('Live egress binding mismatch')
  const localTenant = { ...tenant, apps: { ...tenant.apps, enterprise: { deploymentCode: live.enterpriseDeployment },
    ...(profile.features?.workflowLocal === true ? { workflow: { deploymentCode: 'C000001-test-workflow-local', basePath: '/workflow' } } : {}) } }
  if (profile.identity.consoleFacadeMode === 'local-canonical-facade') {
    const registryVars = JSON.parse(await readFile(resolve(import.meta.dirname, '../.cloudflare-workers/gateway/wrangler.json'), 'utf8')).vars
    if (profile.features?.workflowLocal === true) {
      registryVars.HZY_WORKFLOW_ORIGIN = `http://127.0.0.1:${profile.listeners.workflow.port}`
      registryVars.HZY_AIMS_ORIGIN = `http://127.0.0.1:${profile.listeners.aims.port}`
    }
    facade = createConsoleFacade({ localSecret: secret, credentials, registryVars,
      tenant: localTenant, runtimeDialEndpoint: dialEndpoint, fault: policyFault,
      workflowLocal: profile.features?.workflowLocal === true })
  }
  const policyDelivery = profile.identity.policyBackend === 'verified-runtime'
    ? createPolicyDelivery({ platformToken: credentials.HZY_PLATFORM_INTERNAL_TOKEN,
      revisionProbe: process.env.HZY0_POLICY_REVISION_PROBE === 'true',
      fault: policyFault }) : null
  egress = createConsoleEgress({ localSecret: secret, remoteSecret,
    notificationsInAppOnly: profile.features?.notificationsInAppOnly === true,
    workflowLocal: profile.features?.workflowLocal === true,
    ...(policyDelivery ? { policyFetch: policyDelivery } : {}),
    ...(facade ? { fetchImpl: facade.fetch.bind(facade) } : {}) })
  egress.listen(profile.listeners.gatewayInternal.port, profile.listeners.gatewayInternal.host, () => {
    if (profile.identity.policyBackend === 'verified-runtime') stopPolicySync = startPolicySync(
      createPolicyWake({ facade, tenant: localTenant, localSecret: secret,
        preparePolicy: policyDelivery.prepare, clearPolicy: policyDelivery.clear,
        resetPolicy: policyDelivery.reset, confirmPolicy: policyDelivery.confirm }), { report: value => console.log(JSON.stringify(value)) })
  })
}
const listener = profile.listeners.gatewayIngress
const server = createLocalEnterpriseGateway(profile, secret, facade)
server.listen(listener.port, listener.host, () => {
  console.log('hzy0 gateway listening on ' + listener.host + ':' + listener.port)
})
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  stopPolicySync?.()
  egress?.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 8000).unref()
})
