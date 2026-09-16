// WebDev Issue 报告组件的采集 / 脱敏 / 提交逻辑（阶段 3）
// 详见 webdev/docs/WebDev-Issue-Inbox-Design.md §9

import { toValue, type MaybeRefOrGetter } from 'vue'

export type CapturedConsoleError = {
  level: string
  message: string
  at?: string
}

type BufferedError = CapturedConsoleError & { ts: number }

export type IssueReporterContext = {
  url?: string
  route?: string
  appVersion?: string
  env?: { ua?: string, stage?: string }
  consoleErrors?: CapturedConsoleError[]
}

export type IssueReportPayload = {
  title: string
  description?: string
  kind: string
  severity: string
  scope: 'page' | 'app'
  routePattern?: string
  pageUrl?: string
  fingerprint?: string
  context?: IssueReporterContext
}

export type MyIssue = {
  id: string
  displayNo?: number
  title?: string
  state?: string
  scope?: string
  createdAt?: string
}

const MAX_BUFFER = 20
const MAX_MESSAGE = 500
const ISSUE_REPORT_PATH = '/api/webdev-report/issues'
const consoleErrors: BufferedError[] = []
let installed = false

export type IssueReporterTargetOptions = {
  targetBasePath?: MaybeRefOrGetter<string | null | undefined>
  targetPageUrl?: MaybeRefOrGetter<string | null | undefined>
  targetRoutePattern?: MaybeRefOrGetter<string | null | undefined>
}

export function resolveIssueReporterEndpointPath(targetBasePath: unknown, fallbackPath: string) {
  const raw = String(targetBasePath || '').trim()
  if (!raw) return fallbackPath
  if (!raw.startsWith('/') || raw.includes('://') || raw.includes('?') || raw.includes('#')) return ''

  const normalized = `/${raw.replace(/^\/+|\/+$/g, '')}`
  if (normalized === '/') return ''
  return `${normalized}${ISSUE_REPORT_PATH}`
}

export function resolveIssueReporterPageUrl(targetPageUrl: unknown, origin: string, fallbackPathname: string) {
  const fallback = `${origin}${fallbackPathname}`
  const raw = String(targetPageUrl || '').trim()
  if (!raw) return fallback

  try {
    const expectedOrigin = new URL(origin).origin
    const target = new URL(raw, expectedOrigin)
    if (target.origin !== expectedOrigin) return fallback
    return `${target.origin}${target.pathname}`
  } catch {
    return fallback
  }
}

function stringifyArg(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function pushError(level: string, message: string, at?: string) {
  consoleErrors.push({ level, message: String(message).slice(0, MAX_MESSAGE), at, ts: Date.now() })
  while (consoleErrors.length > MAX_BUFFER) consoleErrors.shift()
}

// 由 client plugin 调用：安装全局错误捕获（环形缓冲）
export function installIssueConsoleCapture() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const originalError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    try {
      pushError('error', args.map(stringifyArg).join(' '))
    } catch {
      // 忽略捕获本身的异常
    }
    originalError(...args)
  }

  window.addEventListener('error', (event) => {
    pushError('error', event.message || 'window error', event.filename ? `${event.filename}:${event.lineno}` : undefined)
  })
  window.addEventListener('unhandledrejection', (event) => {
    pushError('error', `UnhandledRejection: ${stringifyArg((event as PromiseRejectionEvent).reason)}`)
  })
}

const PII_PATTERNS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***'],
  [/\b1[3-9]\d{9}\b/g, '***'],
  [/\b\d{17}[\dXx]\b/g, '***']
]

function redact(input: string) {
  return PII_PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), input)
}

export function useIssueReporter(options: IssueReporterTargetOptions = {}) {
  const route = useRoute()
  const { resolveCurrentAppPath } = useAppUrls()
  const config = useRuntimeConfig()

  function currentRoutePattern() {
    const targetPattern = String(toValue(options.targetRoutePattern) || '').trim()
    if (targetPattern) return targetPattern
    const matched = route.matched?.[route.matched.length - 1]
    return matched?.path || route.path
  }

  function issueReportEndpoint() {
    const targetBasePath = toValue(options.targetBasePath)
    const fallback = resolveCurrentAppPath(ISSUE_REPORT_PATH)
    const endpoint = resolveIssueReporterEndpointPath(targetBasePath, fallback)
    if (String(targetBasePath || '').trim() && !endpoint) {
      throw new Error('反馈目标应用路径无效')
    }
    return endpoint
  }

  function collectContext(): { routePattern: string, pageUrl: string, context: IssueReporterContext } {
    const routePattern = currentRoutePattern()
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const pathname = typeof window !== 'undefined' ? window.location.pathname : route.path
    const pageUrl = resolveIssueReporterPageUrl(toValue(options.targetPageUrl), origin, pathname)
    const stage = String((config.public as Record<string, unknown> | undefined)?.deploymentProfile || '')

    return {
      routePattern,
      pageUrl,
      context: {
        url: pageUrl,
        route: routePattern,
        env: {
          ua: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          stage: stage || undefined
        },
        consoleErrors: consoleErrors.slice(-10).map(item => ({
          level: item.level,
          message: redact(item.message),
          at: item.at
        }))
      }
    }
  }

  async function submit(payload: IssueReportPayload) {
    return await $fetch(issueReportEndpoint(), {
      method: 'POST',
      body: payload
    })
  }

  async function fetchMine(query: { scope?: string, routePattern?: string, pageSize?: number } = {}) {
    return await $fetch<{ items: MyIssue[], total: number }>(issueReportEndpoint(), {
      query
    })
  }

  return { collectContext, submit, fetchMine, currentRoutePattern }
}
