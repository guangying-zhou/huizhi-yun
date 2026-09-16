import { getHeader, type H3Event } from 'h3'
import { getConsoleRuntimeConfig } from './consoleRuntime'
import { requestWithServiceAccessToken } from './serviceOidc'
import { resolveTrustedTenantGatewayContext } from './tenantGatewayTrust'
import { fetchExternal } from './externalFetch'

export interface SubjectEligibilityResult {
  active: boolean
  allowed: boolean
  reason: 'allowed' | 'subject_inactive' | 'permission_denied'
  policyRevision: number | null
}

const text = (value: unknown) => String(value || '').trim()

function trustedGatewayHeaders(event: H3Event) {
  const config = useRuntimeConfig(event) as unknown as Record<string, unknown>
  if (!resolveTrustedTenantGatewayContext(event, config)) return {}
  const headers: Record<string, string> = {}
  for (const name of [
    'x-hzy-gateway', 'x-hzy-gateway-token', 'x-hzy-tenant', 'x-hzy-deployment',
    'x-hzy-environment', 'x-hzy-app-code', 'x-forwarded-host', 'x-forwarded-port',
    'x-forwarded-prefix', 'x-forwarded-proto', 'x-hzy-data-runtime-url',
    'x-hzy-data-runtime-code', 'x-hzy-data-runtime-token', 'x-hzy-data-runtime-audience'
  ]) {
    const value = text(getHeader(event, name))
    if (value) headers[name] = value
  }
  return headers
}

export async function checkSubjectEligibility(input: {
  event: H3Event
  subjectUid: string
  purpose: string
}): Promise<SubjectEligibilityResult> {
  const runtime = await getConsoleRuntimeConfig({ event: input.event })
  const targetAppCode = text(runtime.app.appCode).toLowerCase()
  const tenantId = text(runtime.tenant?.tenantCode)
  const deploymentId = text(runtime.deployment?.deploymentCode)
  const baseUrl = text(runtime.console.baseUrl).replace(/\/+$/, '')
  if (!targetAppCode || !tenantId || !deploymentId || !baseUrl) {
    throw createError({ statusCode: 503, message: 'subject_eligibility_runtime_binding_unavailable' })
  }

  const data = await requestWithServiceAccessToken<Partial<SubjectEligibilityResult>>({
    audience: 'console',
    scope: 'console:authorization:subject-eligibility',
    event: input.event,
    request: async token => await fetchExternal<Partial<SubjectEligibilityResult>>(
      `${baseUrl}/api/v1/console/service/authorization/subject-eligibility`,
      {
        method: 'POST',
        headers: { ...trustedGatewayHeaders(input.event), authorization: `Bearer ${token}` },
        body: {
          subjectUid: text(input.subjectUid),
          purpose: text(input.purpose)
        },
        timeout: 10000
      }
    )
  })
  if (
    typeof data?.active !== 'boolean'
    || typeof data?.allowed !== 'boolean'
    || !['allowed', 'subject_inactive', 'permission_denied'].includes(text(data?.reason))
    || !(data?.policyRevision === null || (Number.isSafeInteger(data?.policyRevision) && Number(data.policyRevision) >= 0))
    || (data.allowed !== (data.active && data.reason === 'allowed'))
    || (!data.active && (data.reason !== 'subject_inactive' || data.policyRevision !== null))
    || (data.active && !data.allowed && data.reason !== 'permission_denied')
  ) {
    throw createError({ statusCode: 502, message: 'subject_eligibility_response_invalid' })
  }
  return data as SubjectEligibilityResult
}
