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
  if (input.appCode !== 'aims' || context?.tenant !== 'C000001'
    || context.appCode !== 'workflow' || context.deployment !== 'C000001-test-workflow-local'
    || context.environment !== 'test' || context.forwardedHost !== 'hzy0.isme.dev'
    || input.canonicalRuntimeUrl !== 'https://hzy-test-runtime.isme.dev'
    || input.dialUrl !== 'http://127.0.0.1:18084') {
    throw new Error('local_callback_gateway_context_invalid')
  }
  if (forwardedHeaders['x-hzy-gateway'] !== 'tenant-gateway'
    || !forwardedHeaders['x-hzy-gateway-token']
    || forwardedHeaders['x-hzy-tenant'] !== 'C000001'
    || forwardedHeaders['x-hzy-app-code'] !== 'aims'
    || forwardedHeaders['x-hzy-deployment'] !== 'C000001-test-aims'
    || forwardedHeaders['x-forwarded-prefix'] !== '/aims') {
    throw new Error('local_callback_target_binding_invalid')
  }
  return { ...forwardedHeaders, 'x-hzy-local-runtime-dial-url': 'http://127.0.0.1:18084' }
}
