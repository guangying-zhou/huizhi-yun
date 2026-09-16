import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { createEvent, type H3Event } from 'h3'
import { readRequestBodyCompat } from '../server/utils/requestBody.ts'

/**
 * Nitro 的 Cloudflare 入口只为 POST/PUT/PATCH 缓冲请求体
 * （`requestHasBody` = `/post|put|patch/i`），DELETE 的 body 会被直接丢弃。
 * 此时 `event.node.req.body` 为 null 而 `content-length` 仍在，h3 `readRawBody`
 * 会退回 node-mock-http 的 mock Readable 等待 'end'——该事件永远不会触发。
 *
 * 下面的 mock 精确复刻 node-mock-http 的行为：`on()` 可以注册监听器，
 * 但 'data' / 'end' 永远不会被 emit。
 */
function createCloudflareMockRequest(method: string, contentLength: number) {
  const req = new EventEmitter() as EventEmitter & Record<string, unknown>
  req.method = method
  req.url = '/api/v1/admin/projects/36'
  req.headers = {
    'content-type': 'application/json',
    'content-length': String(contentLength)
  }
  // Nitro 未缓冲 -> node-mock-http 置为 null
  req.body = null
  // Cloudflare unenv IncomingMessage 的运行时标记
  req.__unenv__ = true
  return req
}

function createMockResponse() {
  const res = new EventEmitter() as EventEmitter & Record<string, unknown>
  res.setHeader = () => res
  res.getHeader = () => undefined
  res.end = () => res
  return res
}

function cloudflareEvent(method: string, payload: string, contentType = 'application/json') {
  const req = createCloudflareMockRequest(method, Buffer.byteLength(payload))
  ;(req.headers as Record<string, string>)['content-type'] = contentType
  const event = createEvent(
    req as never,
    createMockResponse() as never
  ) as H3Event

  ;(event.context as Record<string, unknown>)._platform = {
    cloudflare: {
      request: new Request('https://aims.huizhi.yun/aims/api/v1/admin/projects/36', {
        method,
        headers: { 'content-type': contentType },
        body: payload
      })
    }
  }
  return event
}

async function withTimeout<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`request body read hung for ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, guard])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

test('reads a Cloudflare DELETE body that Nitro did not buffer', async () => {
  const event = cloudflareEvent('DELETE', JSON.stringify({ confirmText: 'ACCNT' }))

  const body = await withTimeout(readRequestBodyCompat<{ confirmText?: string }>(event))

  assert.deepEqual(body, { confirmText: 'ACCNT' })
})

test('reads a Cloudflare DELETE form body that Nitro did not buffer', async () => {
  const event = cloudflareEvent(
    'DELETE',
    'confirmText=ACCNT&reason=cleanup',
    'application/x-www-form-urlencoded'
  )

  const body = await withTimeout(readRequestBodyCompat<Record<string, string>>(event))

  // h3 的 urlencoded 解析返回 null-prototype 对象
  assert.deepEqual({ ...body }, { confirmText: 'ACCNT', reason: 'cleanup' })
})

test('returns undefined for GET without touching the request body', async () => {
  const req = createCloudflareMockRequest('GET', 0)
  delete (req.headers as Record<string, string>)['content-length']
  const event = createEvent(req as never, createMockResponse() as never) as H3Event

  assert.equal(await withTimeout(readRequestBodyCompat(event)), undefined)
})

test('caches the parsed body so repeated reads do not re-consume the stream', async () => {
  const event = cloudflareEvent('DELETE', JSON.stringify({ confirmText: 'ACCNT' }))

  const first = await withTimeout(readRequestBodyCompat<{ confirmText?: string }>(event))
  const second = await withTimeout(readRequestBodyCompat<{ confirmText?: string }>(event))

  assert.deepEqual(first, { confirmText: 'ACCNT' })
  assert.deepEqual(second, { confirmText: 'ACCNT' })
})

test('still uses the buffered body for methods Nitro does buffer', async () => {
  const payload = JSON.stringify({ name: 'buffered' })
  const req = createCloudflareMockRequest('POST', Buffer.byteLength(payload))
  // Nitro 已缓冲 POST -> node-mock-http 收到 Buffer
  req.body = Buffer.from(payload)
  const event = createEvent(req as never, createMockResponse() as never) as H3Event

  const body = await withTimeout(readRequestBodyCompat<{ name?: string }>(event))

  assert.deepEqual(body, { name: 'buffered' })
})

test('recovers a Cloudflare POST body when Nitro did not expose its expected buffer', async () => {
  const event = cloudflareEvent('POST', JSON.stringify({ comment: '需要调整立项材料' }))

  const body = await withTimeout(readRequestBodyCompat<{ comment?: string }>(event))

  assert.deepEqual(body, { comment: '需要调整立项材料' })
})

test('returns undefined when a DELETE carries no body at all', async () => {
  const req = createCloudflareMockRequest('DELETE', 0)
  delete (req.headers as Record<string, string>)['content-length']
  const event = createEvent(req as never, createMockResponse() as never) as H3Event

  assert.equal(await withTimeout(readRequestBodyCompat(event)), undefined)
})
