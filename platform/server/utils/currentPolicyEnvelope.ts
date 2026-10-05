import { createError, setHeader, type H3Event } from 'h3'
import { useRuntimeConfig } from '#imports'
import { findCurrentPolicyEnvelopeRow } from './policyBundle'
import { sign } from './platformSigning'
import { queryRows } from './db'
import { activeConsoleServiceKeys } from './consoleServiceKeys'
import {
  POLICY_ENVELOPE_REFUSALS,
  PolicyEnvelopeRefusal,
  deliverCurrentPolicyEnvelope,
  describeCurrentPolicyRevision
} from './policyEnvelopeDelivery'

type PolicyDeployment = {
  id: number
  tenant_code: string
  deployment_code: string
  environment: string
}

function envValue(event: H3Event, name: string) {
  const env = event.context.cloudflare?.env as Record<string, unknown> | undefined
  return env?.[name] || process.env[name]
}

function envelopeMaxAgeMs(event: H3Event, deployment: PolicyDeployment) {
  // A longer signed lease is opt-in for the pinned C000001 test Console only.
  const testAge = deployment.tenant_code === 'C000001' && deployment.environment === 'test'
    && deployment.deployment_code === 'wiztek-test-console'
    ? envValue(event, 'HZY_PLATFORM_POLICY_ENVELOPE_TEST_MAX_AGE_MS')
    : undefined
  // The general lease stays at the five-minute default until every consumer
  // accepts the 60-minute limit; authz-core rejects anything longer before signing.
  const age = testAge ?? envValue(event, 'HZY_PLATFORM_POLICY_ENVELOPE_MAX_AGE_MS')
  return age === undefined || age === '' ? undefined : Number(age)
}

function policyEnvelopeFailure(error: unknown): never {
  if (error instanceof PolicyEnvelopeRefusal) {
    throw createError({ statusCode: POLICY_ENVELOPE_REFUSALS[error.code], message: 'Current signed policy envelope is refused', data: { code: error.code } })
  }
  throw createError({ statusCode: 503, message: 'Current signed policy envelope is unavailable', data: { code: 'policy_envelope_current_unavailable' } })
}

export async function currentPolicyEnvelope(event: H3Event, deployment: PolicyDeployment) {
  setHeader(event, 'Cache-Control', 'no-store')
  const config = useRuntimeConfig(event)
  const issuer = String(envValue(event, 'HZY_PLATFORM_POLICY_ENVELOPE_ISSUER') || config.policyEnvelopeIssuer || '')
  try {
    return await deliverCurrentPolicyEnvelope({ issuer, tenant: deployment.tenant_code, environment: deployment.environment, deployment: deployment.deployment_code, now: Date.now(), maxAgeMs: envelopeMaxAgeMs(event, deployment) }, {
      current: () => findCurrentPolicyEnvelopeRow(deployment), sign,
      serviceKeys: () => activeConsoleServiceKeys(queryRows, { tenant: deployment.tenant_code, environment: deployment.environment, deployment: deployment.deployment_code }, Date.now())
    })
  } catch (error) {
    policyEnvelopeFailure(error)
  }
}

export async function currentPolicyRevision(event: H3Event, deployment: PolicyDeployment) {
  setHeader(event, 'Cache-Control', 'no-store')
  try {
    return await describeCurrentPolicyRevision({ tenant: deployment.tenant_code, environment: deployment.environment, deployment: deployment.deployment_code, now: Date.now() }, {
      current: () => findCurrentPolicyEnvelopeRow(deployment)
    })
  } catch (error) {
    policyEnvelopeFailure(error)
  }
}

// Route-level lifecycle checks run before the envelope helpers; keep their
// refusal codes identical so the syncer classifies them the same way.
export function policyDeploymentRefusal(status: 'missing' | 'inactive') {
  const code = status === 'missing' ? 'policy_envelope_current_missing' : 'policy_deployment_inactive'
  return createError({ statusCode: POLICY_ENVELOPE_REFUSALS[code], message: 'Current signed policy envelope is refused', data: { code } })
}
