import { createError, getHeader, type H3Event } from 'h3'
import { resolveTrustedTenantGatewayContext, type TrustedTenantGatewayContext } from './tenantGatewayTrust'

// Explicit local test transport, not another issuer or a request-controlled
// override. Disabled in every ordinary/cloud deployment.
export function localConsoleFacadeIdentity(input: {
  enabled: boolean
  workflowLocal?: boolean
  nodeEnv: string
  context: TrustedTenantGatewayContext | null
  proto: string
}) {
  if (!input.enabled) return null
  const context = input.context
  const deployments: Record<string, string> = {
    console: 'wiztek-test-console', enterprise: 'C000001-test-enterprise',
    collab: 'C000001-test-collab',
    ...(input.workflowLocal ? { aims: 'C000001-test-aims', workflow: 'C000001-test-workflow-local' } : {})
  }
  if (input.nodeEnv !== 'development' || !context || context.tenant !== 'C000001'
    || context.environment !== 'test' || context.forwardedHost !== 'hzy0.isme.dev'
    || !deployments[context.appCode] || context.deployment !== deployments[context.appCode]
    || input.proto !== 'https') {
    throw createError({ statusCode: 403, message: 'Local Console facade context rejected' })
  }
  return { issuer: 'https://hzy-test.huizhi.yun', publicEndpointBaseUrl: 'https://hzy0.isme.dev/console' }
}

export function resolveLocalConsoleFacade(event: H3Event) {
  if (process.env.HZY0_LOCAL_CONSOLE_FACADE !== 'true') return null
  return localConsoleFacadeIdentity({ enabled: true, nodeEnv: process.env.NODE_ENV || '',
    workflowLocal: process.env.HZY0_WORKFLOW_LOCAL_ONLY === 'true',
    context: resolveTrustedTenantGatewayContext(event), proto: getHeader(event, 'x-forwarded-proto') || '' })
}
