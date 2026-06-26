export interface HzyDevApplication {
  appCode: string
  appName: string
  description: string | null
  icon: string | null
  homeUrl: string | null
  basePath?: string | null
  apiBase?: string | null
  sortOrder?: number | null
  appType: string
  serviceRole?: string | null
  status?: string | null
}

type EnvRecord = Record<string, string | undefined>

interface ResolveHzyDevApplicationsOptions {
  env?: EnvRecord
  fallback?: readonly HzyDevApplication[]
  logPrefix?: string
}

type DevApplicationRecord = Record<string, unknown>

export const DEFAULT_HZY_DEV_APPLICATIONS: readonly HzyDevApplication[] = [
  {
    appCode: 'codocs',
    appName: '汇智云文档',
    description: '协作文档、知识库、项目文档、部门文档、文档审阅与发布。',
    icon: 'i-lucide-files',
    homeUrl: 'http://localhost:3001/codocs/',
    sortOrder: 10,
    appType: 'business',
    status: 'active'
  },
  {
    appCode: 'aims',
    appName: '汇智云项目',
    description: '研发项目全生命周期管理、任务看板、迭代与报表。',
    icon: 'i-lucide-package',
    homeUrl: 'http://localhost:3002/aims/',
    sortOrder: 20,
    appType: 'business',
    status: 'active'
  },
  {
    appCode: 'altoc',
    appName: '汇智云营销',
    description: '客户、线索、商机、报价、合同与回款管理。',
    icon: 'i-lucide-handshake',
    homeUrl: 'http://localhost:3003/altoc/',
    sortOrder: 30,
    appType: 'business',
    status: 'active'
  },
  {
    appCode: 'assets',
    appName: '汇智云资产',
    description: '企业资产、资源、采购、分配回收与成本归因。',
    icon: 'i-lucide-boxes',
    homeUrl: 'http://localhost:3004/assets/',
    sortOrder: 40,
    appType: 'business',
    status: 'active'
  },
  {
    appCode: 'finance',
    appName: '汇智云财务',
    description: '发票、到账、核销、费用报销、项目支出和项目核算。',
    icon: 'i-lucide-receipt-text',
    homeUrl: 'http://localhost:3006/finance/',
    sortOrder: 50,
    appType: 'business',
    status: 'active'
  },
  {
    appCode: 'insights',
    appName: '汇智云洞察',
    description: '代码仓库监测、贡献者、部门、关系、监控与告警。',
    icon: 'i-lucide-chart-no-axes-combined',
    homeUrl: 'http://localhost:3009/',
    sortOrder: 60,
    appType: 'business',
    status: 'active'
  },
  {
    appCode: 'workflow',
    appName: '汇智云流程',
    description: '通用审批流程引擎、表单定义、条件路由与待办任务。',
    icon: 'i-lucide-route',
    homeUrl: 'http://localhost:3020/workflow/',
    sortOrder: 70,
    appType: 'internal',
    status: 'active'
  }
]

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function nullableString(value: unknown) {
  const normalized = stringValue(value)
  return normalized || null
}

function numberOrNull(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeDevHomeUrl(value: unknown) {
  const normalized = nullableString(value)
  if (!normalized) return null

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
    return normalized
  }

  if (normalized.startsWith('/')) {
    return normalized
  }

  const hostLike = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?:[/?#].*)?$/i
  if (hostLike.test(normalized)) {
    return `http://${normalized}`
  }

  return normalized
}

function cloneDefaultDevApplications(fallback: readonly HzyDevApplication[]) {
  return fallback.map(app => ({ ...app }))
}

function warn(logPrefix: string, message: string) {
  console.warn(`${logPrefix} ${message}`)
}

export function normalizeHzyDevApplication(value: unknown): HzyDevApplication | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as DevApplicationRecord
  const appCode = stringValue(record.appCode)
  if (!appCode) return null

  return {
    appCode,
    appName: stringValue(record.appName) || appCode,
    description: nullableString(record.description),
    icon: nullableString(record.icon),
    homeUrl: normalizeDevHomeUrl(record.homeUrl),
    basePath: nullableString(record.basePath),
    apiBase: nullableString(record.apiBase),
    sortOrder: numberOrNull(record.sortOrder),
    appType: stringValue(record.appType) || 'business',
    serviceRole: nullableString(record.serviceRole),
    status: nullableString(record.status) || 'active'
  }
}

export function resolveHzyDevApplications(options: ResolveHzyDevApplicationsOptions = {}) {
  const env = options.env || process.env
  const fallback = options.fallback || DEFAULT_HZY_DEV_APPLICATIONS
  const logPrefix = options.logPrefix || '[foundation.dev-apps]'
  const raw = stringValue(
    env.HZY_DEV_APPLICATIONS
    || env.HZY_LOCAL_DEV_APPLICATIONS
    || env.HZY_CONSOLE_DEV_APPLICATIONS
    || env.CONSOLE_DEV_APPLICATIONS
  )

  if (!raw) {
    return cloneDefaultDevApplications(fallback)
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      warn(logPrefix, 'HZY_DEV_APPLICATIONS must be a JSON array, using default local dev applications')
      return cloneDefaultDevApplications(fallback)
    }

    return parsed
      .map(item => normalizeHzyDevApplication(item))
      .filter((item): item is HzyDevApplication => Boolean(item))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warn(logPrefix, `Failed to parse HZY_DEV_APPLICATIONS, using default local dev applications: ${message}`)
    return cloneDefaultDevApplications(fallback)
  }
}

export function isActiveHzyDevApplication(app: Pick<HzyDevApplication, 'status'>) {
  const status = stringValue(app.status)
  return !status || status === 'active'
}

export function hzyDevApplicationSortOrder(app: Pick<HzyDevApplication, 'appCode' | 'sortOrder'>) {
  const value = Number(app.sortOrder)
  if (Number.isFinite(value)) return value
  if (app.appCode === 'workspace') return -2000
  if (app.appCode === 'console') return -1000
  return Number.MAX_SAFE_INTEGER
}

export function sortHzyDevApplications<T extends Pick<HzyDevApplication, 'appCode' | 'sortOrder'>>(apps: T[]) {
  return [...apps].sort((a, b) => hzyDevApplicationSortOrder(a) - hzyDevApplicationSortOrder(b) || a.appCode.localeCompare(b.appCode))
}
