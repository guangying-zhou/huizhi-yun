import assert from 'node:assert/strict'
import { test } from 'node:test'
import { headerErrorResponse } from '../header-errors.mjs'

test('overflow is a no-store friendly 431 with byte-accurate body and no reflected input', () => {
  const response = headerErrorResponse({ code: 'HPE_HEADER_OVERFLOW', message: 'SECRET' })
  const [headers, body] = response.split('\r\n\r\n')
  assert.match(headers, /^HTTP\/1.1 431/)
  assert.match(headers, /Cache-Control: no-store/)
  assert.match(headers, new RegExp(`Content-Length: ${Buffer.byteLength(body)}$`))
  assert.match(body, /清除本站 Cookie 后重试/)
  assert.doesNotMatch(response, /SECRET/)
  assert.match(headerErrorResponse({ code: 'HPE_INVALID_METHOD' }), /^HTTP\/1.1 400/)
})

import { configFor, startGateway, startUpstream } from './fixtures.mjs'

test('real ingress parser rejects oversize headers with a friendly 431 before forwarding', async (t) => {
  const upstream = await startUpstream('console')
  const config = configFor([upstream])
  const gateway = await startGateway(config)
  t.after(async () => {
    await gateway.close()
    await upstream.close()
  })
  const response = await gateway.request('/console/', { headers: { cookie: 'synthetic=' + 'x'.repeat(20000) } })
  assert.equal(response.status, 431)
  assert.match(response.body, /清除本站 Cookie/)
  assert.equal(upstream.calls.length, 0)
})
