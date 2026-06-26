// WebDev Issue 报告组件的采集 / 脱敏 / 提交逻辑（阶段 3）
// 详见 webdev/docs/WebDev-Issue-Inbox-Design.md §9

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
const consoleErrors: BufferedError[] = []
let installed = false

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

export function useIssueReporter() {
  const route = useRoute()
  const { resolveCurrentAppPath } = useAppUrls()
  const config = useRuntimeConfig()

  function currentRoutePattern() {
    const matched = route.matched?.[route.matched.length - 1]
    return matched?.path || route.path
  }

  function collectContext(): { routePattern: string, pageUrl: string, context: IssueReporterContext } {
    const routePattern = currentRoutePattern()
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const pathname = typeof window !== 'undefined' ? window.location.pathname : route.path
    const stage = String((config.public as Record<string, unknown> | undefined)?.deploymentProfile || '')

    return {
      routePattern,
      pageUrl: `${origin}${pathname}`,
      context: {
        url: `${origin}${pathname}`,
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
    return await $fetch(resolveCurrentAppPath('/api/webdev-report/issues'), {
      method: 'POST',
      body: payload
    })
  }

  async function fetchMine(query: { scope?: string, routePattern?: string, pageSize?: number } = {}) {
    return await $fetch<{ items: MyIssue[], total: number }>(resolveCurrentAppPath('/api/webdev-report/issues'), {
      query
    })
  }

  return { collectContext, submit, fetchMine, currentRoutePattern }
}
