/** Minimal hzy0 Codocs scheduler envelope. Never import the Gateway Worker into a business build. */
export async function localCodocsSchedulerSignature(input: {
  secret: string
  requestId: string
  issuedAt: string
  path: string
  origin: string
}) {
  const tenant = 'C000001'
  const deployment = 'C000001-test-codocs'
  const runtime = 'https://hzy-test-runtime.isme.dev'
  const host = 'hzy0.isme.dev'
  const routes = JSON.stringify({ codocs: { origin: input.origin, deploymentCode: deployment, basePath: '/codocs/' } })
  const headers = new Headers({
    'content-type': 'application/json',
    'x-hzy-gateway': 'tenant-gateway',
    'x-hzy-scheduler': 'tenant-gateway',
    'x-hzy-tenant': tenant,
    'x-hzy-app-code': 'codocs',
    'x-hzy-environment': 'test',
    'x-forwarded-host': host,
    'x-forwarded-proto': 'https',
    'x-request-id': input.requestId,
    'x-hzy-service-routes': routes,
    'x-hzy-gateway-token': input.secret,
    'x-hzy-deployment': deployment,
    'x-hzy-data-runtime-url': runtime,
    'x-hzy-data-runtime-audience': 'data-runtime',
    'x-hzy-scheduler-issued-at': input.issuedAt
  })
  const canonical = ['POST', input.path, input.requestId, tenant, deployment, 'codocs', 'test', runtime, host, input.issuedAt].join('\n')
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(input.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(canonical)))
  headers.set('x-hzy-scheduler-signature', [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(''))
  return headers
}
