const operations = new Set(['register', 'snapshot', 'open', 'close', 'seal', 'release', 'reconcile', 'resolve-test-uncertain'])
export async function drainControlResponse(request, env) {
  const url = new URL(request.url)
  const operation = url.pathname.slice('/__test/drain/'.length)
  if (url.hostname !== 'hzy-test.huizhi.yun' || env.HZY_TEST_DRAIN_CONTROL_ENABLED !== 'true'
    || !env.HZY_DRAIN_CONTROL_TOKEN || env.HZY_DRAIN_CONTROL_TOKEN === env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN
    || request.headers.get('authorization') !== `Bearer ${env.HZY_DRAIN_CONTROL_TOKEN}`
    || request.method !== 'POST' || !operations.has(operation)) return new Response('Not Found', { status: 404 })
  if (!env.HZY_DRAIN_COORDINATOR) return Response.json({ error: 'drain_binding_missing' }, { status: 503 })
  const raw = await request.text()
  if (raw.length > 32768) return Response.json({ error: 'request_too_large' }, { status: 413 })
  let body
  try { body = JSON.parse(raw) } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }) }
  if (body?.tenant !== 'C000001' || body?.environment !== 'test') return Response.json({ error: 'identity_mismatch' }, { status: 403 })
  const response = await env.HZY_DRAIN_COORDINATOR.fetch(new Request(`https://drain.internal/${operation}`, {
    method: 'POST', headers: { authorization: `Bearer ${env.HZY_DRAIN_CONTROL_TOKEN}`, 'content-type': 'application/json' }, body: raw
  }))
  return new Response(response.body, { status: response.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}
