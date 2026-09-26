import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

const publicHost = 'hzy0.isme.dev'
const requiredSecurityFlags = [
  'effectiveRuntimeBypass',
  'publicInternalOperations',
  'allowBrowserRuntimeOverride',
  'forwardRawEnvironment'
]

export async function readProfile(profilePath) {
  if (!isAbsolute(profilePath)) throw Error('Profile path must be absolute.')
  let value
  try {
    value = JSON.parse(await readFile(profilePath, 'utf8'))
  } catch (error) {
    throw Error(`Unable to read profile: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { profilePath: resolve(profilePath), value, issues: validateProfile(value) }
}

export function validateProfile(profile, { requireApproval = true } = {}) {
  const issues = []
  const requireValue = (value, name) => {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!normalized || /^(?:REQUIRED|PENDING|VERIFY)(?:[_\s-].*)?$/i.test(normalized)) {
      issues.push(`${name} is required`)
    }
    return normalized
  }
  const requireFalse = (value, name) => {
    if (value !== false) issues.push(`${name} must be false`)
  }

  if (!isRecord(profile)) return ['Profile must be a JSON object']
  rejectUnknownKeys(profile, [
    '_notice', 'profileId', 'environment', 'publicOrigin', 'hostEntryPath', 'mode',
    'runtime', 'identity', 'listeners', 'security', 'scheduler', 'processManagement',
    'hmr', 'database', 'features'
  ], 'profile', issues)
  // Optional opt-in switches; absent means off.
  if (profile.features !== undefined) {
    if (!profile.features || typeof profile.features !== 'object' || Array.isArray(profile.features)) issues.push('features must be an object')
    else {
      rejectUnknownKeys(profile.features, ['codocsSnapshotV2', 'codocsCollaborationV2', 'notificationsInAppOnly', 'workflowLocal'], 'features', issues)
      if (profile.features.codocsSnapshotV2 !== undefined && typeof profile.features.codocsSnapshotV2 !== 'boolean') issues.push('features.codocsSnapshotV2 must be a boolean')
      if (profile.features.codocsCollaborationV2 !== undefined && typeof profile.features.codocsCollaborationV2 !== 'boolean') issues.push('features.codocsCollaborationV2 must be a boolean')
      if (profile.features.notificationsInAppOnly !== undefined && typeof profile.features.notificationsInAppOnly !== 'boolean') issues.push('features.notificationsInAppOnly must be a boolean')
      if (profile.features.workflowLocal !== undefined && typeof profile.features.workflowLocal !== 'boolean') issues.push('features.workflowLocal must be a boolean')
      if (profile.features.codocsCollaborationV2 === true && profile.features.codocsSnapshotV2 !== true) issues.push('features.codocsCollaborationV2 requires codocsSnapshotV2')
    }
  }
  if (profile.profileId !== 'hzy0-local-enterprise') issues.push('profileId must be hzy0-local-enterprise')
  if (profile.environment !== 'test') issues.push('environment must be test')
  if (profile.hostEntryPath !== '/enterprise') issues.push('hostEntryPath must be /enterprise')
  if (profile.mode !== 'dev' && profile.mode !== 'node') issues.push('mode must be dev or node')

  try {
    const origin = new URL(requireValue(profile.publicOrigin, 'publicOrigin'))
    if (origin.origin !== `https://${publicHost}` || origin.href !== `https://${publicHost}/`) {
      issues.push(`publicOrigin must be https://${publicHost}`)
    }
  } catch {
    issues.push('publicOrigin must be an absolute HTTPS URL')
  }

  const runtime = record(profile.runtime)
  rejectUnknownKeys(runtime, [
    'canonicalEndpoint', 'transportMode', 'dialEndpoint', 'expectedTenant',
    'expectedRuntimeCode', 'expectedRuntimeDeployment', 'lifecycleManagedByThisStack',
    'automaticFallback'
  ], 'runtime', issues)
  if (runtime.canonicalEndpoint !== 'https://hzy-test-runtime.isme.dev') {
    issues.push('runtime.canonicalEndpoint must be the approved test Runtime endpoint')
  }
  if (!['public-https', 'loopback'].includes(runtime.transportMode)) {
    issues.push('runtime.transportMode must be public-https or loopback')
  }
  if (runtime.transportMode === 'public-https' && runtime.dialEndpoint != null) {
    issues.push('runtime.dialEndpoint must be null for public-https')
  }
  if (runtime.transportMode === 'loopback') {
    const endpoint = requireValue(runtime.dialEndpoint, 'runtime.dialEndpoint')
    if (endpoint !== 'http://127.0.0.1:18084') issues.push('runtime.dialEndpoint must be the pinned loopback Runtime')
  }
  for (const name of ['expectedTenant', 'expectedRuntimeCode', 'expectedRuntimeDeployment']) {
    requireValue(runtime[name], `runtime.${name}`)
  }
  if (runtime.lifecycleManagedByThisStack !== false) issues.push('runtime.lifecycleManagedByThisStack must be false')
  if (runtime.automaticFallback !== false) issues.push('runtime.automaticFallback must be false')

  const identity = record(profile.identity)
  rejectUnknownKeys(identity, [
    'decisionStatus', 'canonicalIssuer', 'canonicalJwksUri', 'consoleFacadeMode',
    'enterpriseAppCode', 'enterpriseDeployment', 'enterpriseOidcClientId',
    'enterpriseServiceClientId', 'consoleDeployment', 'enterpriseRedirectUri',
    'enterpriseLogoutRedirectUri', 'credentialProviderRef', 'allowRuntimeEnrollment',
    'allowIssuerMutation', 'policyBackend'
  ], 'identity', issues)
  const approvedDecision = identity.decisionStatus === 'APPROVED_EXISTING_CANONICAL_CONSOLE'
  if (requireApproval && !approvedDecision) issues.push('identity.decisionStatus must be APPROVED_EXISTING_CANONICAL_CONSOLE')
  for (const name of [
    'canonicalIssuer', 'canonicalJwksUri', 'enterpriseDeployment', 'enterpriseOidcClientId',
    'enterpriseServiceClientId', 'consoleDeployment', 'credentialProviderRef'
  ]) requireValue(identity[name], `identity.${name}`)
  if (!['existing-canonical-console', 'local-canonical-facade'].includes(identity.consoleFacadeMode)) {
    issues.push('identity.consoleFacadeMode must select an approved Console transport')
  }
  if (identity.consoleFacadeMode === 'local-canonical-facade') {
    if (identity.canonicalIssuer !== 'https://hzy-test.huizhi.yun'
      || identity.canonicalJwksUri !== 'https://hzy-test.huizhi.yun/.well-known/jwks.json'
      || identity.consoleDeployment !== 'wiztek-test-console'
      || identity.enterpriseDeployment !== 'C000001-test-enterprise'
      || identity.credentialProviderRef !== 'protected-file:test-gateway'
      || profile.listeners?.console?.port !== 23100) issues.push('Local Console facade identity/listener mismatch')
  }
  if (profile.features?.notificationsInAppOnly === true
    && (identity.consoleFacadeMode !== 'local-canonical-facade'
      || identity.credentialProviderRef !== 'protected-file:test-gateway')) {
    issues.push('features.notificationsInAppOnly requires the local Console egress')
  }
  if (identity.enterpriseAppCode !== 'enterprise') issues.push('identity.enterpriseAppCode must be enterprise')
  if (identity.policyBackend !== undefined && !['runtime', 'verified-runtime'].includes(identity.policyBackend)) issues.push('identity.policyBackend is invalid')
  if (identity.policyBackend === 'verified-runtime' && (identity.consoleFacadeMode !== 'local-canonical-facade'
    || runtime.expectedTenant !== 'C000001' || runtime.expectedRuntimeCode !== 'c000001-test-tenant-runtime'
    || runtime.expectedRuntimeDeployment !== 'c000001-test-tenant-runtime')) issues.push('Verified policy requires the pinned local Console facade')
  if (identity.allowRuntimeEnrollment !== false) issues.push('identity.allowRuntimeEnrollment must be false')
  if (identity.allowIssuerMutation !== false) issues.push('identity.allowIssuerMutation must be false')
  if (identity.enterpriseRedirectUri !== `https://${publicHost}/enterprise/api/auth/oidc-callback`) {
    issues.push('identity.enterpriseRedirectUri must use the approved hzy0 callback')
  }
  if (identity.enterpriseLogoutRedirectUri !== `https://${publicHost}/enterprise/login`) {
    issues.push('identity.enterpriseLogoutRedirectUri must use the approved hzy0 logout redirect')
  }

  const ports = []
  rejectUnknownKeys(record(profile.listeners), ['caddy', 'gatewayIngress', 'gatewayInternal', 'enterprise', 'codocsEditor', 'console', 'collab', 'workflow', 'aims'], 'listeners', issues)
  for (const [name, listener] of Object.entries(record(profile.listeners))) {
    if (!isRecord(listener) || listener.host !== '127.0.0.1' || !Number.isInteger(listener.port) || listener.port < 1024 || listener.port > 65535) {
      issues.push(`listeners.${name} must bind 127.0.0.1 on a valid non-privileged port`)
      continue
    }
    ports.push(listener.port)
  }
  if (!['caddy', 'gatewayIngress', 'gatewayInternal', 'enterprise', 'codocsEditor', 'console'].every(name => isRecord(record(profile.listeners)[name]))) {
    issues.push('listeners must define caddy, gatewayIngress, gatewayInternal, enterprise, codocsEditor, and console')
  }
  if (new Set(ports).size !== ports.length) issues.push('listener ports must be unique')
  if (profile.listeners?.codocsEditor?.port !== 23130) issues.push('codocsEditor.port must be 23130 for the loopback-only editor')
  if (profile.features?.workflowLocal === true) {
    if (profile.identity.consoleFacadeMode !== 'local-canonical-facade') issues.push('workflowLocal requires the local Console facade')
    if (profile.runtime.transportMode !== 'loopback') issues.push('workflowLocal requires the pinned loopback Runtime')
    if (profile.listeners?.workflow?.host !== '127.0.0.1' || profile.listeners?.workflow?.port !== 23140) issues.push('listeners.workflow must be 127.0.0.1:23140')
    if (profile.listeners?.aims?.host !== '127.0.0.1' || profile.listeners?.aims?.port !== 23141) issues.push('listeners.aims must be 127.0.0.1:23141')
  } else if (profile.listeners?.workflow !== undefined || profile.listeners?.aims !== undefined) issues.push('listeners.workflow and listeners.aims require workflowLocal')
  if (profile.features?.codocsCollaborationV2 === true) {
    if (identity.consoleFacadeMode !== 'local-canonical-facade') issues.push('collaboration requires the local Console facade')
    if (profile.listeners?.collab?.host !== '127.0.0.1' || profile.listeners?.collab?.port !== 23131) issues.push('listeners.collab must be 127.0.0.1:23131')
  }
  // This phase deliberately pins the private Host adapter to one loopback port.
  if (profile.listeners?.gatewayInternal?.port !== 23121) issues.push('gatewayInternal.port must be 23121 in the read-only Dev phase')

  const security = record(profile.security)
  rejectUnknownKeys(security, [
    'effectiveRuntimeBypass', 'requiredOuterAccessProtection', 'outerAccessProtectionVerified',
    'publicInternalOperations', 'gatewayCredentialRef', 'allowBrowserRuntimeOverride',
    'forwardRawEnvironment'
  ], 'security', issues)
  for (const name of requiredSecurityFlags) requireFalse(security[name], `security.${name}`)
  if (security.requiredOuterAccessProtection !== true || security.outerAccessProtectionVerified !== true) {
    issues.push('outer access protection must be enabled and verified before startup')
  }
  requireValue(security.gatewayCredentialRef, 'security.gatewayCredentialRef')

  const scheduler = record(profile.scheduler)
  rejectUnknownKeys(scheduler, [
    'registerBusinessCron', 'consumeBusinessOutbox', 'registerAdditionalSharedRefreshWriter'
  ], 'scheduler', issues)
  for (const name of ['registerBusinessCron', 'consumeBusinessOutbox', 'registerAdditionalSharedRefreshWriter']) {
    requireFalse(scheduler[name], `scheduler.${name}`)
  }

  const processManagement = record(profile.processManagement)
  rejectUnknownKeys(processManagement, [
    'processPrefix', 'pm2Home', 'runtimeAndDatabaseExcluded', 'instances', 'watch', 'execMode'
  ], 'processManagement', issues)
  if (processManagement.processPrefix !== 'hzy0-') issues.push('processManagement.processPrefix must be hzy0-')
  if (!isAbsolute(String(processManagement.pm2Home || ''))) issues.push('processManagement.pm2Home must be an absolute path')
  else if (!resolve(processManagement.pm2Home).endsWith('/hzy0/pm2')) issues.push('processManagement.pm2Home must be a dedicated hzy0/pm2 directory')
  if (processManagement.runtimeAndDatabaseExcluded !== true) issues.push('processManagement.runtimeAndDatabaseExcluded must be true')
  if (processManagement.instances !== 1 || processManagement.watch !== false || processManagement.execMode !== 'fork') {
    issues.push('process management must use one non-watching forked instance')
  }

  const hmr = record(profile.hmr)
  rejectUnknownKeys(hmr, ['publicProtocol', 'publicHost', 'publicPort', 'allowedHosts'], 'hmr', issues)
  if (hmr.publicProtocol !== 'wss' || hmr.publicHost !== publicHost || hmr.publicPort !== 443) {
    issues.push('hmr must use wss://hzy0.isme.dev:443')
  }
  if (!Array.isArray(hmr.allowedHosts) || hmr.allowedHosts.length !== 1 || hmr.allowedHosts[0] !== publicHost) {
    issues.push('hmr.allowedHosts must contain only hzy0.isme.dev')
  }
  const database = record(profile.database)
  rejectUnknownKeys(database, ['credentialsInFrontend', 'manageLifecycle', 'runMigrations'], 'database', issues)
  if (database.credentialsInFrontend !== false || database.manageLifecycle !== false || database.runMigrations !== false) {
    issues.push('database credentials, lifecycle, and migrations must remain disabled')
  }
  return issues
}

export function profileSummary(profile) {
  const runtime = record(profile.runtime)
  const identity = record(profile.identity)
  const listeners = record(profile.listeners)
  return {
    profileId: profile.profileId,
    environment: profile.environment,
    publicOrigin: profile.publicOrigin,
    hostEntryPath: profile.hostEntryPath,
    mode: profile.mode,
    runtime: {
      canonicalEndpoint: runtime.canonicalEndpoint,
      transportMode: runtime.transportMode,
      dialEndpointConfigured: Boolean(runtime.dialEndpoint),
      expectedTenant: runtime.expectedTenant,
      expectedRuntimeCode: runtime.expectedRuntimeCode
    },
    identity: {
      decisionStatus: identity.decisionStatus,
      consoleFacadeMode: identity.consoleFacadeMode,
      enterpriseDeployment: identity.enterpriseDeployment,
      consoleDeployment: identity.consoleDeployment,
      credentialProviderConfigured: Boolean(identity.credentialProviderRef)
    },
    listeners,
    processes: ['hzy0-gateway', 'hzy0-enterprise', 'hzy0-codocs-editor',
      ...(identity.consoleFacadeMode === 'local-canonical-facade' ? ['hzy0-console'] : []),
      ...(profile.features?.codocsCollaborationV2 === true ? ['hzy0-collab'] : [])],
    excluded: ['runtime', 'database', 'cloudflared', 'global-caddy', 'shared-schedulers']
  }
}

export function record(value) {
  return isRecord(value) ? value : {}
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function rejectUnknownKeys(value, allowed, name, issues) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(`${name}.${key} is not allowed`)
  }
}
