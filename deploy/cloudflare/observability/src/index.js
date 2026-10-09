const DEFAULT_SAMPLE_RATE = 0.05
const DEFAULT_ERROR_SAMPLE_RATE = 1
const DEFAULT_SLOW_THRESHOLD_MS = 2500
const MAX_BODY_BYTES = 32 * 1024
const MAX_BATCH_EVENTS = 25
const SUMMARY_BUCKET_MS = 5 * 60 * 1000

const DEFAULT_APPS = ['console', 'workflow', 'codocs', 'aims', 'altoc', 'assets', 'finance']
const ALLOWED_EVENT_TYPES = new Set([
  'page_view',
  'web_vital',
  'api_timing',
  'js_error',
  'resource_timing'
])

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return corsResponse(request)
    }

    if (url.pathname === '/health') {
      return jsonResponse({
        ok: true,
        bindings: {
          analyticsEngine: Boolean(getAnalyticsEngine(env)),
          d1: Boolean(env.RUM_DB)
        }
      }, 200, request)
    }

    if (isRumIngestPath(url.pathname)) {
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'method_not_allowed' }, 405, request)
      }

      return handleRumIngest(request, env)
    }

    if (url.pathname === '/api/observability/summary') {
      if (!isAdminAuthorized(request, env)) {
        return jsonResponse({ error: 'unauthorized' }, 401, request)
      }

      return handleSummary(request, env)
    }

    if (url.pathname === '/api/observability/settings') {
      if (!isAdminAuthorized(request, env)) {
        return jsonResponse({ error: 'unauthorized' }, 401, request)
      }

      if (request.method === 'GET') {
        return handleSettingsGet(request, env)
      }

      if (request.method === 'PUT') {
        return handleSettingsPut(request, env)
      }

      return jsonResponse({ error: 'method_not_allowed' }, 405, request)
    }

    return jsonResponse({ error: 'not_found' }, 404, request)
  }
}

function isRumIngestPath(pathname) {
  return pathname === '/api/rum' || pathname === '/rum' || pathname === '/cdn-cgi/rum'
}

async function handleRumIngest(request, env) {
  const contentLength = Number(request.headers.get('content-length') || '0')
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ accepted: 0, dropped: 0, error: 'payload_too_large' }, 413, request)
  }

  const payload = await readJson(request)
  if (!payload) {
    return jsonResponse({ accepted: 0, dropped: 0, error: 'invalid_json' }, 400, request)
  }

  const rawEvents = Array.isArray(payload.events) ? payload.events : [payload]
  const events = rawEvents.slice(0, MAX_BATCH_EVENTS)
  let accepted = 0
  let dropped = Math.max(0, rawEvents.length - events.length)
  const summaryWrites = []

  for (const rawEvent of events) {
    const event = normalizeRumEvent(rawEvent, request)
    if (!event) {
      dropped += 1
      continue
    }

    const setting = await loadSetting(env, event.tenantCode, event.appCode)
    if (!setting.enabled) {
      dropped += 1
      continue
    }

    const sampleRate = samplingRateFor(event, setting)
    if (Math.random() > sampleRate) {
      dropped += 1
      continue
    }

    writeAnalyticsEvent(env, event, request, sampleRate)
    summaryWrites.push(writeSummary(env, event, setting))
    accepted += 1
  }

  if (summaryWrites.length) {
    await Promise.allSettled(summaryWrites)
  }

  await recordIngestCounters(env, request, accepted, dropped)

  return jsonResponse({ accepted, dropped }, 202, request)
}

async function handleSummary(request, env) {
  const url = new URL(request.url)
  const tenantCode = cleanIdentifier(url.searchParams.get('tenantCode') || '')
  const appCode = cleanIdentifier(url.searchParams.get('appCode') || '')
  const hours = clampNumber(Number(url.searchParams.get('hours') || '24'), 1, 168)

  if (!tenantCode) {
    return jsonResponse({ error: 'tenantCode_required' }, 400, request)
  }

  if (!env.RUM_DB) {
    return jsonResponse({ error: 'd1_not_configured' }, 503, request)
  }

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
  const params = [tenantCode, since]
  const appClause = appCode ? 'AND app_code = ?' : ''
  if (appCode) {
    params.push(appCode)
  }

  const [overview, buckets, counters] = await Promise.all([
    env.RUM_DB.prepare(
      `SELECT app_code,
              event_type,
              SUM(count) AS count,
              SUM(error_count) AS error_count,
              SUM(slow_count) AS slow_count,
              SUM(total_value) AS total_value,
              MAX(max_value) AS max_value
       FROM rum_summary_buckets
       WHERE tenant_code = ?
         AND bucket_start >= ?
         ${appClause}
       GROUP BY app_code, event_type
       ORDER BY app_code, event_type`
    ).bind(...params).all(),
    env.RUM_DB.prepare(
      `SELECT bucket_start,
              app_code,
              event_type,
              route,
              metric_name,
              count,
              error_count,
              slow_count,
              total_value,
              max_value
       FROM rum_summary_buckets
       WHERE tenant_code = ?
         AND bucket_start >= ?
         ${appClause}
       ORDER BY bucket_start DESC
       LIMIT 500`
    ).bind(...params).all(),
    env.RUM_DB.prepare(
      `SELECT day,
              tenant_code,
              app_code,
              accepted_count,
              dropped_count,
              updated_at
       FROM rum_ingest_counters
       WHERE tenant_code = ?
       ORDER BY day DESC, app_code ASC
       LIMIT 60`
    ).bind(tenantCode).all()
  ])

  return jsonResponse({
    tenantCode,
    appCode: appCode || null,
    windowHours: hours,
    overview: mapOverviewRows(overview.results || []),
    buckets: mapBucketRows(buckets.results || []),
    counters: counters.results || []
  }, 200, request)
}

async function handleSettingsGet(request, env) {
  const url = new URL(request.url)
  const tenantCode = cleanIdentifier(url.searchParams.get('tenantCode') || '')

  if (!tenantCode) {
    return jsonResponse({ error: 'tenantCode_required' }, 400, request)
  }

  if (!env.RUM_DB) {
    return jsonResponse({
      tenantCode,
      items: DEFAULT_APPS.map(appCode => defaultSetting(tenantCode, appCode))
    }, 200, request)
  }

  const rows = await env.RUM_DB.prepare(
    `SELECT tenant_code,
            app_code,
            enabled,
            sample_rate,
            error_sample_rate,
            slow_threshold_ms,
            created_at,
            updated_at
     FROM rum_settings
     WHERE tenant_code = ?
     ORDER BY app_code`
  ).bind(tenantCode).all()

  const existing = new Map((rows.results || []).map(row => [row.app_code, mapSettingRow(row)]))
  for (const appCode of DEFAULT_APPS) {
    if (!existing.has(appCode)) {
      existing.set(appCode, defaultSetting(tenantCode, appCode))
    }
  }

  return jsonResponse({
    tenantCode,
    items: Array.from(existing.values()).sort((a, b) => a.appCode.localeCompare(b.appCode))
  }, 200, request)
}

async function handleSettingsPut(request, env) {
  const body = await readJson(request)
  if (!body || !env.RUM_DB) {
    return jsonResponse({ error: env.RUM_DB ? 'invalid_json' : 'd1_not_configured' }, env.RUM_DB ? 400 : 503, request)
  }

  const tenantCode = cleanIdentifier(body.tenantCode || '')
  const appCode = cleanIdentifier(body.appCode || '')
  if (!tenantCode || !appCode) {
    return jsonResponse({ error: 'tenantCode_and_appCode_required' }, 400, request)
  }

  const enabled = body.enabled === undefined ? true : Boolean(body.enabled)
  const sampleRate = clampNumber(Number(body.sampleRate ?? DEFAULT_SAMPLE_RATE), 0, 1)
  const errorSampleRate = clampNumber(Number(body.errorSampleRate ?? DEFAULT_ERROR_SAMPLE_RATE), 0, 1)
  const slowThresholdMs = Math.round(clampNumber(Number(body.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS), 100, 60000))
  const now = new Date().toISOString()

  await env.RUM_DB.prepare(
    `INSERT INTO rum_settings (
       tenant_code,
       app_code,
       enabled,
       sample_rate,
       error_sample_rate,
       slow_threshold_ms,
       created_at,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_code, app_code) DO UPDATE SET
       enabled = excluded.enabled,
       sample_rate = excluded.sample_rate,
       error_sample_rate = excluded.error_sample_rate,
       slow_threshold_ms = excluded.slow_threshold_ms,
       updated_at = excluded.updated_at`
  ).bind(
    tenantCode,
    appCode,
    enabled ? 1 : 0,
    sampleRate,
    errorSampleRate,
    slowThresholdMs,
    now,
    now
  ).run()

  return jsonResponse({
    tenantCode,
    appCode,
    enabled,
    sampleRate,
    errorSampleRate,
    slowThresholdMs,
    updatedAt: now
  }, 200, request)
}

function normalizeRumEvent(rawEvent, request) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return null
  }

  if (isCloudflareBrowserInsightsEvent(rawEvent)) {
    return normalizeCloudflareBrowserInsightsEvent(rawEvent, request)
  }

  const eventType = cleanIdentifier(rawEvent.eventType || rawEvent.type || '')
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    return null
  }

  const tenantCode = cleanIdentifier(
    rawEvent.tenantCode ||
    rawEvent.tenant ||
    request.headers.get('x-hzy-tenant') ||
    tenantFromHost(new URL(request.url).hostname)
  )
  const appCode = cleanIdentifier(rawEvent.appCode || rawEvent.app || '')

  if (!tenantCode || !appCode) {
    return null
  }

  const status = parseInteger(rawEvent.status || rawEvent.statusCode || 0)
  const numericValue = parseFiniteNumber(rawEvent.value ?? rawEvent.duration ?? rawEvent.durationMs ?? 0)
  const duration = parseFiniteNumber(rawEvent.duration ?? rawEvent.durationMs ?? numericValue)
  const timestamp = parseTimestamp(rawEvent.ts || rawEvent.timestamp)
  const route = sanitizePath(rawEvent.route || rawEvent.path || rawEvent.url || '')

  return {
    schemaVersion: parseInteger(rawEvent.schemaVersion || 1) || 1,
    eventId: truncateString(rawEvent.eventId || crypto.randomUUID(), 64),
    eventType,
    tenantCode,
    appCode,
    route,
    metricName: truncateString(cleanMetric(rawEvent.metricName || rawEvent.metric || eventType), 64),
    method: truncateString(cleanIdentifier(rawEvent.method || ''), 12),
    status,
    ok: rawEvent.ok === undefined ? status < 400 : Boolean(rawEvent.ok),
    value: numericValue,
    duration,
    message: truncateString(rawEvent.message || '', 180),
    userAgentFamily: userAgentFamily(request.headers.get('user-agent') || ''),
    timestamp
  }
}

function isCloudflareBrowserInsightsEvent(rawEvent) {
  return Boolean(
    rawEvent.timingsV2
    && typeof rawEvent.timingsV2 === 'object'
    && (rawEvent.location || rawEvent.referrer || rawEvent.pageloadId)
  )
}

function normalizeCloudflareBrowserInsightsEvent(rawEvent, request) {
  const location = String(rawEvent.location || rawEvent.referrer || '').trim()
  const route = sanitizePath(location || rawEvent.timingsV2?.name || '')
  const tenantCode = cleanIdentifier(
    request.headers.get('x-hzy-tenant')
    || tenantFromHost(new URL(request.url).hostname)
    || rawEvent.tenantCode
    || rawEvent.tenant
  )
  const appCode = cleanIdentifier(rawEvent.appCode || rawEvent.app || appCodeFromRoute(route))

  if (!tenantCode || !appCode) {
    return null
  }

  const duration = parseFiniteNumber(rawEvent.timingsV2?.duration || 0)
  const status = parseInteger(rawEvent.timingsV2?.responseStatus || 0)
  const timestamp = rawEvent.startTime
    ? new Date(parseFiniteNumber(rawEvent.startTime))
    : new Date()

  return {
    schemaVersion: 1,
    eventId: truncateString(rawEvent.pageloadId || crypto.randomUUID(), 64),
    eventType: 'page_view',
    tenantCode,
    appCode,
    route,
    metricName: 'cloudflare_browser_insights',
    method: 'GET',
    status,
    ok: status ? status < 400 : true,
    value: duration,
    duration,
    message: '',
    userAgentFamily: userAgentFamily(request.headers.get('user-agent') || ''),
    timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp
  }
}

function writeAnalyticsEvent(env, event, request, sampleRate) {
  const analyticsEngine = getAnalyticsEngine(env)
  if (!analyticsEngine || typeof analyticsEngine.writeDataPoint !== 'function') {
    return
  }

  const cf = request.cf || {}
  analyticsEngine.writeDataPoint({
    indexes: [event.tenantCode],
    blobs: [
      event.tenantCode,
      event.appCode,
      event.eventType,
      event.route,
      event.metricName,
      event.method,
      statusGroup(event.status),
      String(cf.colo || ''),
      String(cf.country || ''),
      event.userAgentFamily
    ],
    doubles: [
      event.value,
      event.duration,
      event.status,
      sampleRate,
      event.timestamp.getTime(),
      event.ok ? 1 : 0,
      event.schemaVersion
    ]
  })
}

function getAnalyticsEngine(env) {
  return env.HUIZHI_YUN_ANALYTICS_ENGINE || env.RUM_EVENTS
}

async function writeSummary(env, event, setting) {
  if (!env.RUM_DB) {
    return
  }

  const bucketStart = new Date(Math.floor(event.timestamp.getTime() / SUMMARY_BUCKET_MS) * SUMMARY_BUCKET_MS).toISOString()
  const now = new Date().toISOString()
  const errorCount = isErrorEvent(event) ? 1 : 0
  const slowCount = event.duration >= setting.slowThresholdMs ? 1 : 0

  await env.RUM_DB.prepare(
    `INSERT INTO rum_summary_buckets (
       bucket_start,
       bucket_granularity,
       tenant_code,
       app_code,
       event_type,
       route,
       metric_name,
       count,
       error_count,
       slow_count,
       total_value,
       max_value,
       updated_at
     )
     VALUES (?, '5m', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
     ON CONFLICT(bucket_start, bucket_granularity, tenant_code, app_code, event_type, route, metric_name)
     DO UPDATE SET
       count = count + 1,
       error_count = error_count + excluded.error_count,
       slow_count = slow_count + excluded.slow_count,
       total_value = total_value + excluded.total_value,
       max_value = CASE WHEN excluded.max_value > max_value THEN excluded.max_value ELSE max_value END,
       updated_at = excluded.updated_at`
  ).bind(
    bucketStart,
    event.tenantCode,
    event.appCode,
    event.eventType,
    event.route,
    event.metricName,
    errorCount,
    slowCount,
    event.value,
    event.value,
    now
  ).run()
}

async function recordIngestCounters(env, request, accepted, dropped) {
  if (!env.RUM_DB || (!accepted && !dropped)) {
    return
  }

  const day = new Date().toISOString().slice(0, 10)
  const tenantCode = cleanIdentifier(request.headers.get('x-hzy-tenant') || tenantFromHost(new URL(request.url).hostname) || 'unknown')
  const now = new Date().toISOString()

  await env.RUM_DB.prepare(
    `INSERT INTO rum_ingest_counters (
       day,
       tenant_code,
       app_code,
       accepted_count,
       dropped_count,
       updated_at
     )
     VALUES (?, ?, '*', ?, ?, ?)
     ON CONFLICT(day, tenant_code, app_code)
     DO UPDATE SET
       accepted_count = accepted_count + excluded.accepted_count,
       dropped_count = dropped_count + excluded.dropped_count,
       updated_at = excluded.updated_at`
  ).bind(day, tenantCode, accepted, dropped, now).run()
}

async function loadSetting(env, tenantCode, appCode) {
  if (!env.RUM_DB) {
    return defaultSetting(tenantCode, appCode)
  }

  try {
    const row = await env.RUM_DB.prepare(
      `SELECT tenant_code,
              app_code,
              enabled,
              sample_rate,
              error_sample_rate,
              slow_threshold_ms,
              created_at,
              updated_at
       FROM rum_settings
       WHERE tenant_code = ?
         AND app_code = ?
       LIMIT 1`
    ).bind(tenantCode, appCode).first()

    return row ? mapSettingRow(row) : defaultSetting(tenantCode, appCode)
  } catch (error) {
    console.warn('[observability] failed to load RUM setting, using defaults', error)
    return defaultSetting(tenantCode, appCode)
  }
}

function defaultSetting(tenantCode, appCode) {
  return {
    tenantCode,
    appCode,
    enabled: true,
    sampleRate: DEFAULT_SAMPLE_RATE,
    errorSampleRate: DEFAULT_ERROR_SAMPLE_RATE,
    slowThresholdMs: DEFAULT_SLOW_THRESHOLD_MS,
    createdAt: null,
    updatedAt: null
  }
}

function mapSettingRow(row) {
  return {
    tenantCode: row.tenant_code,
    appCode: row.app_code,
    enabled: Boolean(row.enabled),
    sampleRate: Number(row.sample_rate ?? DEFAULT_SAMPLE_RATE),
    errorSampleRate: Number(row.error_sample_rate ?? DEFAULT_ERROR_SAMPLE_RATE),
    slowThresholdMs: Number(row.slow_threshold_ms ?? DEFAULT_SLOW_THRESHOLD_MS),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  }
}

function mapOverviewRows(rows) {
  return rows.map(row => ({
    appCode: row.app_code,
    eventType: row.event_type,
    count: Number(row.count || 0),
    errorCount: Number(row.error_count || 0),
    slowCount: Number(row.slow_count || 0),
    avgValue: Number(row.count || 0) > 0 ? Number(row.total_value || 0) / Number(row.count || 1) : 0,
    maxValue: Number(row.max_value || 0)
  }))
}

function mapBucketRows(rows) {
  return rows.map(row => ({
    bucketStart: row.bucket_start,
    appCode: row.app_code,
    eventType: row.event_type,
    route: row.route,
    metricName: row.metric_name,
    count: Number(row.count || 0),
    errorCount: Number(row.error_count || 0),
    slowCount: Number(row.slow_count || 0),
    avgValue: Number(row.count || 0) > 0 ? Number(row.total_value || 0) / Number(row.count || 1) : 0,
    maxValue: Number(row.max_value || 0)
  }))
}

function samplingRateFor(event, setting) {
  return isErrorEvent(event)
    ? setting.errorSampleRate
    : setting.sampleRate
}

function isErrorEvent(event) {
  return event.eventType === 'js_error' || event.status >= 500 || event.ok === false
}

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function isAdminAuthorized(request, env) {
  const token = String(env.HZY_OBSERVABILITY_ADMIN_TOKEN || '').trim()
  if (!token) {
    return true
  }

  const headerToken = String(request.headers.get('x-hzy-observability-token') || '').trim()
  const authorization = String(request.headers.get('authorization') || '').trim()
  const bearerToken = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : ''

  return headerToken === token || bearerToken === token
}

function jsonResponse(payload, status = 200, request = null) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders(request, {
      'content-type': 'application/json;charset=utf-8',
      'cache-control': 'no-store'
    })
  })
}

function corsResponse(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, {
      'access-control-max-age': '86400'
    })
  })
}

function corsHeaders(request, extra = {}) {
  const origin = request?.headers?.get('origin') || '*'
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-hzy-tenant,x-hzy-observability-token',
    'access-control-allow-credentials': origin === '*' ? 'false' : 'true',
    ...extra
  }
}

function cleanIdentifier(value) {
  return truncateString(String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.*-]/g, ''), 64)
}

function cleanMetric(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.:-]/g, '_')
}

function tenantFromHost(hostname) {
  const parts = String(hostname || '').split('.')
  return parts.length > 2 ? parts[0] : ''
}

function appCodeFromRoute(route) {
  const firstSegment = String(route || '')
    .replace(/^\/+/, '')
    .split('/')[0]
  return DEFAULT_APPS.includes(firstSegment) ? firstSegment : 'console'
}

function sanitizePath(value) {
  const raw = String(value || '').trim()
  if (!raw) return '/'

  try {
    const url = raw.startsWith('http://') || raw.startsWith('https://')
      ? new URL(raw)
      : new URL(raw, 'https://placeholder.local')

    return truncateString(url.pathname || '/', 180)
  } catch {
    return truncateString(raw.split('?')[0].split('#')[0] || '/', 180)
  }
}

function userAgentFamily(userAgent) {
  const value = userAgent.toLowerCase()
  if (value.includes('edg/')) return 'edge'
  if (value.includes('chrome/')) return 'chrome'
  if (value.includes('firefox/')) return 'firefox'
  if (value.includes('safari/') && !value.includes('chrome/')) return 'safari'
  if (value.includes('bot') || value.includes('crawler')) return 'bot'
  return 'other'
}

function statusGroup(status) {
  if (!status) return ''
  return `${Math.floor(status / 100)}xx`
}

function parseTimestamp(value) {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function parseFiniteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function parseInteger(value) {
  const number = Number.parseInt(String(value || '0'), 10)
  return Number.isFinite(number) ? number : 0
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(max, Math.max(min, value))
}

function truncateString(value, maxLength) {
  const text = String(value || '')
  return text.length > maxLength ? text.slice(0, maxLength) : text
}
