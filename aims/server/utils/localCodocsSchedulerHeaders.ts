import { localCodocsSchedulerSignature } from '@hzy/foundation/server/utils/localCodocsSchedulerSignature'
import type { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'

const TARGET_DEPLOYMENT = 'C000001-test-codocs'
const RUNTIME_ENDPOINT = 'https://hzy-test-runtime.isme.dev'
const SERVICE_PATH = /^\/codocs\/api\/v1\/service\/company-weekly-summaries\/[0-9]{4}-W(?:0[1-9]|[1-4][0-9]|5[0-3]):publish$/

/**
 * Event-less W40 delivery has no inbound Gateway headers to forward. Only the
 * private hzy0 runner may sign the target request with the existing Gateway
 * scheduler canonicalization. Other scheduled and cloud calls stay unchanged.
 */
export async function localCodocsSchedulerHeaders(path: string, targetDeployment: string, requestId: string): Promise<Record<string, string>> {
  if (process.env.HZY0_CODOCS_LOCAL_ONLY !== 'true'
    || process.env.HZY0_LOCAL_CONSOLE_FACADE !== 'true'
    || process.env.HZY0_COMPANY_SUMMARY_CODOCS_DELIVERY !== 'true') return {}
  if (!SERVICE_PATH.test(path) || !/^[-A-Za-z0-9_]{1,128}$/.test(requestId) || targetDeployment !== TARGET_DEPLOYMENT
    || process.env.HZY_CODOCS_TARGET_DEPLOYMENT !== TARGET_DEPLOYMENT
    || process.env.HZY_TENANT_RUNTIME_TENANT !== 'C000001'
    || process.env.HZY_TENANT_RUNTIME_URL !== RUNTIME_ENDPOINT
    || process.env.HZY_PLATFORM_ENVIRONMENT !== 'test') return {}
  const secret = String(process.env.HZY0_GATEWAY_INTERNAL_TOKEN || '')
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) return {}
  const origin = String(process.env.HZY_CODOCS_SERVICE_BASE_URL || '').trim()
  if (origin !== 'http://127.0.0.1:23130/codocs') return {}
  const headers = await localCodocsSchedulerSignature({ secret, requestId, issuedAt: String(Date.now()), path, origin: 'http://127.0.0.1:23130' })
  return Object.fromEntries(headers.entries())
}

type VerifiedScheduler = Awaited<ReturnType<typeof requireTenantGatewaySchedulerRequest>>

/** Only the already verified Aims unified wake may mint a new Codocs target proof. */
export async function localUnifiedCompanySummaryCodocsHeaders(
  verified: VerifiedScheduler | undefined,
  operation: { tenantCode?: unknown, deploymentCode?: unknown, operationCode?: unknown },
  path: string,
  targetDeployment: string,
  requestId: string
): Promise<Record<string, string>> {
  if (!verified || verified.tenant !== 'C000001' || verified.environment !== 'test'
    || verified.appCode !== 'aims' || verified.deployment !== 'C000001-test-aims'
    || !['unified', 'recovered'].includes(verified.schedulerStorage)
    || verified.tenant !== operation.tenantCode || verified.deployment !== operation.deploymentCode
    || operation.operationCode !== 'aims.company-weekly-summary.codocs-publish.v1') return {}
  return localCodocsSchedulerHeaders(path, targetDeployment, requestId)
}
