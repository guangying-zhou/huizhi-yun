type RumPublicConfig = {
  enabled?: boolean | string
  endpoint?: string
  sampleRate?: number | string
}

type RumEventType = 'page_view' | 'web_vital' | 'api_timing' | 'js_error' | 'resource_timing'

type RumEvent = {
  schemaVersion: 1
  eventId: string
  eventType: RumEventType
  appCode: string
  tenantCode: string
  route: string
  metricName: string
  value?: number
  duration?: number
  status?: number
  ok?: boolean
  method?: string
  message?: string
  ts: string
}

declare global {
  interface Window {
    __HZY_RUM_INSTALLED__?: boolean
  }
}

const DEFAULT_SAMPLE_RATE = 0.05
const MAX_BATCH_SIZE = 10
const SEND_INTERVAL_MS = 5000

export default defineNuxtPlugin((nuxtApp) => {
  if (window.__HZY_RUM_INSTALLED__) {
    return
  }
  window.__HZY_RUM_INSTALLED__ = true

  const runtimeConfig = useRuntimeConfig()
  const publicConfig = (runtimeConfig.public || {}) as Record<string, unknown>
  const rumConfig = isRecord(publicConfig.rum) ? publicConfig.rum as RumPublicConfig : {}
  const enabled = parseBoolean(rumConfig.enabled ?? publicConfig.rumEnabled ?? true)

  if (!enabled) {
    return
  }

  const appCode = stringValue(publicConfig.appCode || publicConfig.appName || 'unknown')
  const endpoint = resolveRumEndpoint(stringValue(rumConfig.endpoint || publicConfig.rumEndpoint || '/api/rum'))
  const sampleRate = clampNumber(Number(rumConfig.sampleRate ?? publicConfig.rumSampleRate ?? DEFAULT_SAMPLE_RATE), 0, 1)
  const sessionSampled = resolveSessionSampled(appCode, sampleRate)
  const eventQueue: RumEvent[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let lcpValue = 0
  let clsValue = 0
  let fcpReported = false

  const auth = useAuth()
  const route = useRoute()

  function baseEvent(input: Omit<RumEvent, 'schemaVersion' | 'eventId' | 'appCode' | 'tenantCode' | 'route' | 'ts'> & { route?: string }): RumEvent {
    return {
      schemaVersion: 1,
      eventId: crypto.randomUUID(),
      appCode,
      tenantCode: resolveTenantCode(publicConfig, auth),
      route: sanitizePath(input.route || route.fullPath || window.location.pathname),
      ts: new Date().toISOString(),
      ...input
    }
  }

  function enqueue(event: RumEvent, force = false) {
    if (!force && !sessionSampled) {
      return
    }

    eventQueue.push(event)

    if (eventQueue.length >= MAX_BATCH_SIZE || force) {
      flush()
      return
    }

    if (!flushTimer) {
      flushTimer = setTimeout(flush, SEND_INTERVAL_MS)
    }
  }

  function flush() {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }

    if (!eventQueue.length) {
      return
    }

    const events = eventQueue.splice(0, MAX_BATCH_SIZE)
    const body = JSON.stringify({ events })

    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))
      if (sent) {
        return
      }
    }

    fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body,
      keepalive: true,
      credentials: 'omit'
    }).catch(() => {
      // RUM must never affect product flows.
    })
  }

  function reportPageView() {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const duration = navigation?.duration || performance.now()
    const ttfb = navigation ? Math.max(0, navigation.responseStart - navigation.requestStart) : 0

    enqueue(baseEvent({
      eventType: 'page_view',
      metricName: 'page_load',
      value: duration,
      duration
    }))

    if (ttfb) {
      enqueue(baseEvent({
        eventType: 'web_vital',
        metricName: 'ttfb',
        value: ttfb,
        duration: ttfb
      }))
    }
  }

  function reportVitals() {
    if (lcpValue) {
      enqueue(baseEvent({
        eventType: 'web_vital',
        metricName: 'lcp',
        value: lcpValue,
        duration: lcpValue
      }))
      lcpValue = 0
    }

    if (clsValue) {
      enqueue(baseEvent({
        eventType: 'web_vital',
        metricName: 'cls',
        value: Number(clsValue.toFixed(4)),
        duration: 0
      }))
      clsValue = 0
    }
  }

  function installPerformanceObservers() {
    if (!('PerformanceObserver' in window)) {
      return
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint' && !fcpReported) {
            fcpReported = true
            enqueue(baseEvent({
              eventType: 'web_vital',
              metricName: 'fcp',
              value: entry.startTime,
              duration: entry.startTime
            }))
          }
        }
      }).observe({ type: 'paint', buffered: true })
    } catch {
      // Optional metric.
    }

    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const last = entries[entries.length - 1]
        if (last) {
          lcpValue = last.startTime
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    } catch {
      // Optional metric.
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const layoutShift = entry as PerformanceEntry & { value?: number, hadRecentInput?: boolean }
          if (!layoutShift.hadRecentInput) {
            clsValue += Number(layoutShift.value || 0)
          }
        }
      }).observe({ type: 'layout-shift', buffered: true })
    } catch {
      // Optional metric.
    }
  }

  function installFetchObserver() {
    const originalFetch = window.fetch.bind(window)

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      const method = stringValue(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
      const startedAt = performance.now()

      try {
        const response = await originalFetch(input, init)
        reportApiTiming(url, method, response.status, response.ok, performance.now() - startedAt)
        return response
      } catch (error) {
        reportApiTiming(url, method, 0, false, performance.now() - startedAt)
        throw error
      }
    }
  }

  function reportApiTiming(url: URL | null, method: string, status: number, ok: boolean, duration: number) {
    if (!url || !shouldTrackApiUrl(url)) {
      return
    }

    enqueue(baseEvent({
      eventType: 'api_timing',
      metricName: 'api',
      route: url.pathname,
      method,
      status,
      ok,
      value: duration,
      duration
    }), status >= 500 || !ok)
  }

  window.addEventListener('error', (event) => {
    enqueue(baseEvent({
      eventType: 'js_error',
      metricName: 'window_error',
      value: 1,
      duration: 0,
      ok: false,
      message: stringValue(event.message || event.error?.message || 'window error')
    }), true)
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    enqueue(baseEvent({
      eventType: 'js_error',
      metricName: 'unhandled_rejection',
      value: 1,
      duration: 0,
      ok: false,
      message: stringValue(reason?.message || reason || 'unhandled rejection')
    }), true)
  })

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      reportVitals()
      flush()
    }
  })
  window.addEventListener('pagehide', () => {
    reportVitals()
    flush()
  })

  nuxtApp.hook('page:finish', () => {
    window.setTimeout(reportPageView, 0)
  })

  installPerformanceObservers()
  installFetchObserver()
})

function resolveRumEndpoint(value: string) {
  try {
    return new URL(value || '/api/rum', window.location.origin).toString()
  } catch {
    return '/api/rum'
  }
}

function resolveSessionSampled(appCode: string, sampleRate: number) {
  const key = `hzy-rum:${appCode}:sampled`

  try {
    const existing = window.sessionStorage.getItem(key)
    if (existing === '1') return true
    if (existing === '0') return false

    const sampled = Math.random() < sampleRate
    window.sessionStorage.setItem(key, sampled ? '1' : '0')
    return sampled
  } catch {
    return Math.random() < sampleRate
  }
}

function resolveTenantCode(publicConfig: Record<string, unknown>, auth: ReturnType<typeof useAuth>) {
  const authTenant = stringValue(unref(auth.tenant))
  if (authTenant) return authTenant

  const configured = stringValue(publicConfig.tenantCode || publicConfig.tenant || publicConfig.platformTenantCode)
  if (configured) return configured

  const host = window.location.hostname
  const parts = host.split('.')
  return parts.length > 2 ? parts[0] || 'unknown' : 'unknown'
}

function shouldTrackApiUrl(url: URL) {
  if (url.origin !== window.location.origin) {
    return false
  }

  if (url.pathname === '/api/rum' || url.pathname === '/rum') {
    return false
  }

  return url.pathname.includes('/api/')
}

function requestUrl(input: RequestInfo | URL) {
  try {
    if (input instanceof Request) {
      return new URL(input.url)
    }

    return new URL(String(input), window.location.origin)
  } catch {
    return null
  }
}

function sanitizePath(value: string) {
  try {
    const url = new URL(value, window.location.origin)
    return url.pathname || '/'
  } catch {
    const path = String(value || '/').split('?')[0] || '/'
    return path.split('#')[0] || '/'
  }
}

function parseBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value
  }

  const normalized = stringValue(value).toLowerCase()
  if (!normalized) {
    return false
  }

  return !['0', 'false', 'off', 'no'].includes(normalized)
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(max, Math.max(min, value))
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
