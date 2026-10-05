interface TrustedWorkflowContext {
  tenant: string
  deployment: string
  environment: string
  appCode: string
  forwardedHost: string
}

export function verifiedLocalWorkflowCallbackHeaders(input: {
  appCode: string
  context: TrustedWorkflowContext | null
  canonicalRuntimeUrl: string
  dialUrl: string
  forwardedHeaders: Record<string, string>
}) {
  const { context, forwardedHeaders } = input
  if (!['aims', 'enterprise'].includes(input.appCode) || context?.tenant !== 'C000001'
    || context.appCode !== 'workflow' || context.deployment !== 'C000001-test-workflow-local'
    || context.environment !== 'test' || context.forwardedHost !== 'hzy0.isme.dev'
    || input.canonicalRuntimeUrl !== 'https://hzy-test-runtime.isme.dev'
    || input.dialUrl !== 'http://127.0.0.1:18084') {
    throw new Error('local_callback_gateway_context_invalid')
  }
  if (forwardedHeaders['x-hzy-gateway'] !== 'tenant-gateway'
    || !forwardedHeaders['x-hzy-gateway-token']
    || forwardedHeaders['x-hzy-tenant'] !== 'C000001'
    || forwardedHeaders['x-hzy-app-code'] !== input.appCode
    || forwardedHeaders['x-hzy-deployment'] !== `C000001-test-${input.appCode}`
    || forwardedHeaders['x-forwarded-prefix'] !== `/${input.appCode}`) {
    throw new Error('local_callback_target_binding_invalid')
  }
  return { ...forwardedHeaders, 'x-hzy-local-runtime-dial-url': 'http://127.0.0.1:18084' }
}

/**
 * Self-hosted single site (G-10): the callback is dialed on loopback, bypassing
 * the Tenant Gateway, so it must carry the verified inbound Gateway context
 * with the target app/deployment/prefix atomically rewritten by Foundation's
 * trusted route helper — exactly what the Gateway would have generated. No
 * hzy0 Runtime dial header may ride along; the target resolves its own Runtime
 * dial from its startup-validated configuration.
 */
export function verifiedSelfHostedCallbackHeaders(input: {
  appCode: string
  context: TrustedWorkflowContext | null
  route: { deploymentCode: string, basePath: string } | null
  forwardedHeaders: Record<string, string>
}) {
  const { context, route, forwardedHeaders } = input
  if (!context || context.appCode !== 'workflow' || !context.tenant || !context.deployment || !route?.deploymentCode) {
    throw new Error('self_hosted_callback_gateway_context_invalid')
  }
  const prefix = route.basePath.replace(/\/+$/, '') || '/'
  if (forwardedHeaders['x-hzy-gateway'] !== 'tenant-gateway'
    || !forwardedHeaders['x-hzy-gateway-token']
    || forwardedHeaders['x-hzy-tenant'] !== context.tenant
    || forwardedHeaders['x-hzy-app-code'] !== input.appCode
    || forwardedHeaders['x-hzy-deployment'] !== route.deploymentCode
    || forwardedHeaders['x-forwarded-prefix'] !== prefix
    || 'x-hzy-local-runtime-dial-url' in forwardedHeaders) {
    throw new Error('self_hosted_callback_target_binding_invalid')
  }
  return { ...forwardedHeaders }
}
