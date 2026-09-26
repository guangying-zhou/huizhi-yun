// Only explicitly reviewed protocol errors, never arbitrary upstream diagnostics.
const codes = {
  invalid_token: [401, 'Authentication is required'],
  enterprise_policy_version_changed: [401, 'Session policy version has changed'],
  insufficient_scope: [403, 'Permission is required'],
  enterprise_catalog_forbidden: [403, 'Permission is required'],
  enterprise_directory_changed: [409, 'Product directory changed; restart pagination'],
  idempotency_key_conflict: [409, 'The request conflicts with an earlier operation'],
  idempotency_payload_mismatch: [409, 'The request conflicts with an earlier operation'],
  assets_product_conflict: [409, 'The product conflicts with an existing record'],
  codocs_version_expired: [410, 'This version is past the 30-day retention period'],
  snapshot_generation_conflict: [409, 'The document was updated elsewhere; reload before saving'],
  document_on_snapshot_v2: [409, 'The document is saved with the new protocol; reload before saving'],
  enterprise_assets_unavailable: [503, 'Service temporarily unavailable'],
  service_token_introspection_unavailable: [503, 'Service temporarily unavailable'],
  enterprise_catalog_unavailable: [503, 'Service temporarily unavailable'],
  enterprise_module_runtime_not_ready: [503, 'This function is not available in the local Enterprise build'],
  enterprise_document_storage_unavailable: [503, 'Document storage is temporarily unavailable'],
  enterprise_document_access_record_unavailable: [503, 'Document access recording is temporarily unavailable'],
  hzy0_console_egress_denied: [403, 'The local Enterprise service capability is not approved'],
  hzy0_console_egress_failed: [502, 'Console egress request failed'],
  policy_delivery_prepared_unavailable: [503, 'Service temporarily unavailable'],
  console_session_verification_unavailable: [503, 'Service temporarily unavailable'],
  console_session_runtime_unavailable: [503, 'Service temporarily unavailable'],
  verified_console_context_missing: [503, 'Service temporarily unavailable'],
  verified_console_route_missing: [503, 'Service temporarily unavailable'],
  verified_console_policy_receipt_invalid: [503, 'Service temporarily unavailable'],
  verified_console_policy_unavailable: [503, 'Service temporarily unavailable'],
  local_console_policy_unavailable: [503, 'Service temporarily unavailable'],
  enterprise_policy_persistence_required: [503, 'Service temporarily unavailable'],
  enterprise_policy_reader_unavailable: [503, 'Service temporarily unavailable'],
  enterprise_policy_invalid_or_expired: [503, 'Service temporarily unavailable'],
  enterprise_policy_deployment_required: [503, 'Service temporarily unavailable']
}
export function safeError(status, contentType, body) {
  const fallback = { statusCode: status, message: 'Local Enterprise request failed', code: 'hzy0_upstream_error' }
  if (!/^application\/json(?:;|$)/i.test(contentType || '') || Buffer.byteLength(body) > 65536) return fallback
  try {
    const value = JSON.parse(body)
    if (!value || Array.isArray(value) || typeof value !== 'object' || (value.statusCode !== undefined && value.statusCode !== status)) return fallback
    const code = value?.data?.code || value?.code || value?.error?.code || value?.error
    if (!Object.hasOwn(codes, code) || codes[code][0] !== status) return fallback
    const data = { code }
    const correlationId = value.correlationId || value?.data?.correlationId
    if (typeof correlationId === 'string' && /^[0-9a-f-]{36}$/i.test(correlationId)) data.correlationId = correlationId
    if (status === 409) for (const key of ['expectedVersion', 'currentVersion']) {
      const number = value?.data?.[key]
      if (Number.isSafeInteger(number) && number >= 0) data[key] = number
    }
    return { statusCode: status, code, message: codes[code][1], data }
  } catch { return fallback }
}
export function safeErrorHeaders(status, headers, { allowCookieClear = false } = {}) {
  const output = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  const retry = headers['retry-after']
  if ([429, 503, 409].includes(status) && /^\d{1,4}$/.test(retry || '') && Number(retry) <= 3600) output['retry-after'] = retry
  if (allowCookieClear) {
    const cookies = [].concat(headers['set-cookie'] || []).filter(cookie =>
      /^hzy_(?:access_token|id_token|refresh_token|uid|tenant|subject_code|policy_ver|oidc_state|oidc_nonce|oidc_code_verifier)=;/.test(cookie)
      && /;\s*Max-Age=0(?:;|$)/i.test(cookie) && !/;\s*Domain=/i.test(cookie)
      && !/[\r\n]/.test(cookie) && cookie.length < 1024)
    if (cookies.length) output['set-cookie'] = cookies
  }
  return output
}

const navigationMessages = Object.freeze({
  401: '请登录后重试。',
  403: '您没有访问此页面的权限。',
  409: '页面状态已变化，请重试。',
  503: '服务暂时不可用，请稍后重试。'
})

export function wantsNavigationHtml(method, pathname, headers = {}) {
  if (!['GET', 'HEAD'].includes(method)) return false
  if (/(?:^|\/)api(?:\/|$)/.test(pathname)
    || /(?:^|\/)oauth\/(?:userinfo|token)(?:\/|$)/.test(pathname)
    || /(?:^|\/)\.well-known(?:\/|$)/.test(pathname)
    || /(?:^|\/)(?:_nuxt|_nitro|__nuxt_devtools__|fonts|pdfjs)(?:\/|$)/.test(pathname)
    || /(?:^|\/)(?:__vite_ws|__vite_ping)(?:\/|$)/.test(pathname)
    || /\.(?:js|mjs|css|map|json|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|wasm|pdf)(?:$|\/)/i.test(pathname)) return false
  const fetchMode = String(headers['sec-fetch-mode'] || '').toLowerCase()
  const preferred = String(headers.accept || '').split(',')[0]?.trim().toLowerCase()
  return fetchMode === 'navigate' || (/^text\/html(?:\s*;|$)/.test(preferred)
    && !/(?:^|;)\s*q\s*=\s*0(?:\.0*)?(?:;|$)/.test(preferred))
}

export function safeCorrelationId(contentType, body) {
  if (!/^application\/json(?:;|$)/i.test(contentType || '') || Buffer.byteLength(body) > 65536) return undefined
  try {
    const value = JSON.parse(body)
    const id = value?.correlationId || value?.data?.correlationId
    return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : undefined
  } catch { return undefined }
}

export function navigationErrorHtml(status, correlationId) {
  const message = navigationMessages[status] || '请求暂时无法完成，请重试。'
  const reference = typeof correlationId === 'string' && /^[0-9a-f-]{36}$/i.test(correlationId)
    ? `<p class="reference">问题编号：${correlationId}</p>` : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>汇智云 · 页面暂不可用</title><style>
    :root{color-scheme:light dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fafafa;color:#18181b}
    body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;box-sizing:border-box}
    main{width:min(100%,420px);padding:32px;border:1px solid #e4e4e7;border-radius:12px;background:#fff;box-sizing:border-box}
    h1{font-size:20px;margin:0 0 12px}p{line-height:1.6;margin:0 0 24px;color:#3f3f46}
    .actions{display:flex;gap:12px;align-items:center}button,a{font:inherit;border-radius:8px;padding:9px 16px;cursor:pointer}
    button{border:0;background:#9f2d00;color:#fff}a{color:#9f2d00;text-decoration:none}button:focus-visible,a:focus-visible{outline:2px solid #1447e6;outline-offset:3px}
    .reference{font-size:12px;color:#6b6b74;margin:24px 0 0;overflow-wrap:anywhere}
    @media(prefers-color-scheme:dark){:root{background:#18181b;color:#fafafa}main{background:#1f1f23;border-color:#3f3f46}p{color:#e4e4e7}button{background:#ff6900;color:#18181b}a{color:#ffb86a}.reference{color:#a1a1aa}button:focus-visible,a:focus-visible{outline-color:#51a2ff}}
  </style></head><body><main><h1>页面暂不可用</h1><p>${message}</p><div class="actions"><button type="button" onclick="location.reload()">重试</button><a href="/enterprise">返回首页</a></div>${reference}</main></body></html>`
}
