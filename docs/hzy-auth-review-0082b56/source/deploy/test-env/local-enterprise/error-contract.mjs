// Only explicitly reviewed protocol errors, never arbitrary upstream diagnostics.
const codes = {
  invalid_token: [401, 'Authentication is required'],
  insufficient_scope: [403, 'Permission is required'],
  enterprise_catalog_forbidden: [403, 'Permission is required'],
  enterprise_directory_changed: [409, 'Product directory changed; restart pagination'],
  idempotency_key_conflict: [409, 'The request conflicts with an earlier operation'],
  idempotency_payload_mismatch: [409, 'The request conflicts with an earlier operation'],
  assets_product_conflict: [409, 'The product conflicts with an existing record'],
  enterprise_assets_unavailable: [503, 'Service temporarily unavailable'],
  service_token_introspection_unavailable: [503, 'Service temporarily unavailable'],
  enterprise_catalog_unavailable: [503, 'Service temporarily unavailable']
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
