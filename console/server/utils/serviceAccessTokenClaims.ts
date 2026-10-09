type JWTPayload = import('jose').JWTPayload
type JoseModule = typeof import('jose')

let joseModulePromise: Promise<JoseModule> | null = null

function loadJose() {
  joseModulePromise ||= import('jose')
  return joseModulePromise
}

export interface ServiceAccessTokenClaimsInput {
  audience: string
  scope: string
  expiresIn: number
  serviceClient: {
    clientId: string
    clientCode: string
    clientName: string
    clientType: string
    appCode: string | null
    credentialId: number
  }
}

export interface ServiceAccessTokenSigningContext {
  issuer: string
  now: number
  tenantCode: string | null
  deploymentCode: string | null
  policyVersion: string | null
  caps: string | null
  signingKey: {
    alg: string
    kid: string
    key: CryptoKey | Uint8Array
  }
}

export interface ServiceAccessTokenPolicyBinding {
  tenantCode: string | null
  deploymentCode: string | null
  policyVersion: string | null
  caps: string | null
}

export interface TrustedServiceTokenSourceBinding {
  tenantCode: string
  deploymentCode: string
  appCode: string
}

function normalized(value: unknown) {
  return String(value || '').trim()
}

export function bindServiceAccessTokenPolicyToTrustedSource(input: {
  policy: ServiceAccessTokenPolicyBinding
  serviceClientAppCode: string | null
  trustedSource?: TrustedServiceTokenSourceBinding | null
}) {
  if (!input.trustedSource) return input.policy

  const tenantCode = normalized(input.trustedSource.tenantCode)
  const deploymentCode = normalized(input.trustedSource.deploymentCode)
  const sourceAppCode = normalized(input.trustedSource.appCode)
  const serviceClientAppCode = normalized(input.serviceClientAppCode)
  const policyTenantCode = normalized(input.policy.tenantCode)

  if (!tenantCode || !deploymentCode || !sourceAppCode || !serviceClientAppCode) {
    throw new Error('trusted service-token source binding is incomplete')
  }
  if (sourceAppCode !== serviceClientAppCode) {
    throw new Error('trusted service-token source app does not match the service client')
  }
  if (policyTenantCode && tenantCode !== policyTenantCode) {
    throw new Error('trusted service-token source tenant does not match the policy tenant')
  }

  return {
    ...input.policy,
    tenantCode,
    deploymentCode
  }
}

/**
 * Bind a credential-backed runtime client to its own application deployment
 * when it is operating as a cross-app target outside Tenant Gateway routing.
 * The caller supplies only the binding mode; app identity comes from the
 * credential and tenant comes from Console policy or a verified Tenant
 * Gateway context. An explicit binding for this app takes precedence over
 * the legacy production naming convention; another app's deployment is never reused.
 */
export function bindServiceAccessTokenPolicyToServiceClient(input: {
  policy: ServiceAccessTokenPolicyBinding
  serviceClientAppCode: string | null
  serviceClientCode: string
  trustedSource?: TrustedServiceTokenSourceBinding | null
}) {
  const policyTenantCode = normalized(input.policy.tenantCode)
  const trustedTenantCode = normalized(input.trustedSource?.tenantCode)
  const tenantCode = policyTenantCode || trustedTenantCode
  const appCode = normalized(input.serviceClientAppCode)
  const clientCode = normalized(input.serviceClientCode)
  const canonicalRuntimeClient = clientCode === `${appCode}.runtime`
  const credentialBoundSupportingService = Boolean(
    trustedTenantCode
    && normalized(input.trustedSource?.deploymentCode)
    && normalized(input.trustedSource?.appCode) === appCode
    && clientCode
  )
  if (!tenantCode || !appCode || (!canonicalRuntimeClient && !credentialBoundSupportingService)) {
    throw new Error('service client policy binding requires an exact runtime client')
  }
  if (policyTenantCode && trustedTenantCode && policyTenantCode !== trustedTenantCode) {
    throw new Error('trusted service-token source tenant does not match the policy tenant')
  }
  const ownAppBinding = normalized(input.trustedSource?.appCode) === appCode
  const boundDeployment = normalized(input.trustedSource?.deploymentCode)
  if (ownAppBinding && !boundDeployment) {
    throw new Error('service client policy binding requires an exact deployment')
  }
  return {
    ...input.policy,
    tenantCode,
    deploymentCode: ownAppBinding ? boundDeployment : `${tenantCode}-${appCode}`
  }
}

export function buildServiceAccessTokenClaims(
  input: ServiceAccessTokenClaimsInput,
  context: Omit<ServiceAccessTokenSigningContext, 'signingKey' | 'now'>
) {
  return {
    iss: context.issuer,
    sub: `client:${input.serviceClient.clientCode}`,
    aud: input.audience,
    azp: input.serviceClient.clientId,
    client_id: input.serviceClient.clientId,
    scope: input.scope,
    source_app: input.serviceClient.appCode,
    target_app: input.audience,
    tenant: context.tenantCode,
    deployment: context.deploymentCode,
    policy_ver: context.policyVersion,
    caps: context.caps,
    token_use: 'service',
    hzy: {
      subjectType: 'service',
      subjectCode: input.serviceClient.clientCode,
      clientCode: input.serviceClient.clientCode,
      clientName: input.serviceClient.clientName,
      clientType: input.serviceClient.clientType,
      appCode: input.serviceClient.appCode,
      credentialId: input.serviceClient.credentialId
    }
  } satisfies JWTPayload & Record<string, unknown>
}

export async function signServiceAccessTokenWithContext(
  input: ServiceAccessTokenClaimsInput,
  context: ServiceAccessTokenSigningContext
) {
  const claims = buildServiceAccessTokenClaims(input, context)
  const { SignJWT } = await loadJose()
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: context.signingKey.alg, kid: context.signingKey.kid, typ: 'JWT' })
    .setIssuedAt(context.now)
    .setExpirationTime(context.now + input.expiresIn)
    .sign(context.signingKey.key)
}
