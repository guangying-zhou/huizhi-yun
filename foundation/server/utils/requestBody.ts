import { getHeader, readBody, type H3Event } from 'h3'

/**
 * 跨运行时安全读取请求体。
 *
 * Nitro 的 Cloudflare 入口通常会为 POST/PUT/PATCH 缓冲请求体：
 *
 * ```js
 * // nitropack/runtime/internal/utils.mjs
 * const METHOD_WITH_BODY_RE = /post|put|patch/i
 * export function requestHasBody(request) {
 *   return METHOD_WITH_BODY_RE.test(request.method)
 * }
 * ```
 *
 * 因此带 body 的 DELETE 进入 Worker 后 `event.node.req.body` 为 null，而
 * `content-length` 仍然存在。h3 `readRawBody` 此时会退回 Node 流事件：
 *
 * ```js
 * new Promise((resolve, reject) => {
 *   event.node.req.on('end', () => resolve(Buffer.concat(bodyData)))
 * })
 * ```
 *
 * 但 Worker 里的 `event.node.req` 是 node-mock-http 的 mock Readable，
 * 永远不会 emit 'data' / 'end'，Promise 永不 settle，Worker 直接挂死，
 * 由 Cloudflare 以「code had hung and would never generate a response」取消请求。
 * 该挂死没有任何日志，`.catch()` 也无法捕获。
 *
 * 实际 Worker 请求也可能出现 POST/PUT/PATCH 的预期缓冲体未暴露给 h3
 * 的情况。这里只要发现缓冲体缺失，就从 Cloudflare 原始 Request 取回 body，
 * 写入 h3 优先读取的 `event._requestBody` 后再交给 `readBody`，
 * 保持 content-type 解析语义与 h3 完全一致。
 */

const BODYLESS_METHODS = new Set(['GET', 'HEAD'])
const requestBodyPrimedKey = Symbol('hzy.requestBody.primed')

type RequestBodyEventContext = H3Event['context'] & {
  [requestBodyPrimedKey]?: boolean
  _platform?: { cloudflare?: { request?: Request } }
  cloudflare?: { request?: Request }
}

type RequestBodyEvent = H3Event & { _requestBody?: unknown }

function requestMethod(event: H3Event) {
  return String(event.node.req.method || 'GET').toUpperCase()
}

function platformRequest(event: H3Event) {
  const context = event.context as RequestBodyEventContext
  return context._platform?.cloudflare?.request || context.cloudflare?.request || null
}

function hasBufferedBody(event: H3Event) {
  const request = event.node.req as { body?: unknown, rawBody?: unknown }
  return Boolean((event as RequestBodyEvent)._requestBody || request.body || request.rawBody)
}

function declaresBody(event: H3Event) {
  const contentLength = Number.parseInt(String(getHeader(event, 'content-length') || ''), 10)
  if (contentLength > 0) return true
  return /\bchunked\b/i.test(String(getHeader(event, 'transfer-encoding') || ''))
}

/**
 * node-mock-http 的 IncomingMessage 带 `__unenv__` 标记，其流事件永远不会触发。
 * 识别出它可以在拿不到原始 Request 时安全放弃读取，而不是让 Worker 挂死。
 */
function isMockedNodeRequest(event: H3Event) {
  return '__unenv__' in (event.node.req as unknown as Record<string, unknown>)
}

/**
 * 把 Cloudflare 原始 Request 的 body 预置到 `event._requestBody`。
 * 预置后本请求内任何 `readBody(event)` 调用都能正常返回。
 */
async function primeUnbufferedRequestBody(event: H3Event) {
  const context = event.context as RequestBodyEventContext
  if (context[requestBodyPrimedKey]) return
  if (hasBufferedBody(event)) return

  const request = platformRequest(event)
  if (!request || request.bodyUsed) return

  const raw = await request.arrayBuffer()
  context[requestBodyPrimedKey] = true
  if (raw.byteLength === 0) return
  ;(event as RequestBodyEvent)._requestBody = Buffer.from(raw)
}

/**
 * 读取当前请求体，GET/HEAD 返回 undefined。
 * 只要 Nitro 缓冲体缺失，就先从平台原始 Request 补齐，
 * 避免在 Cloudflare Workers 上永久挂起。
 */
export async function readRequestBodyCompat<T = unknown>(event: H3Event): Promise<T | undefined> {
  const method = requestMethod(event)
  if (BODYLESS_METHODS.has(method)) return undefined

  if (!hasBufferedBody(event)) {
    await primeUnbufferedRequestBody(event)
  }

  if (!hasBufferedBody(event)) {
    // 没有声明 body 时 h3 会安全返回 undefined；声明了却拿不到，
    // 只有 mock 流会挂死，此处直接放弃读取。
    if (!declaresBody(event)) return undefined
    if (isMockedNodeRequest(event)) return undefined
  }

  return await readBody<T>(event)
}
