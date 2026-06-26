import { createError } from 'h3'

const AUTO_CLAIM_APPS_DEFAULT = ['finance', 'workflow', 'codocs']
const APP_REPO: Record<string, string> = {}

function appRepo(appCode: string) {
  // 业务应用 → 仓库映射；当前为单体仓 huizhi-yun，后续可配置化
  return APP_REPO[appCode] || 'huizhi-yun'
}

function normSeverity(value: unknown): string {
  const severity = String(value || '').toLowerCase()
  return ['high', 'mid', 'low'].includes(severity) ? severity : 'mid'
}

function normKind(value: unknown): string {
  const kind = String(value || '').toLowerCase()
  return ['bug', 'feature', 'question'].includes(kind) ? kind : 'bug'
}

function redactUrl(value: unknown): string {
  const url = String(value || '').trim()
  if (!url) return ''
  // 服务端二次脱敏：去除 query / hash，避免回传敏感参数
  return url.split('#')[0]!.split('?')[0]!
}

const SEVERITY_RANK: Record<string, number> = { low: 1, mid: 2, high: 3 }

function envAutoClaimApps(): string[] {
  const raw = String(process.env.HZY_WEBDEV_AUTO_CLAIM_APPS || '').trim()
  return raw ? raw.split(/[,\s]+/).filter(Boolean) : AUTO_CLAIM_APPS_DEFAULT
}

function unwrap<T>(result: unknown): T {
  return ((result as { data?: unknown })?.data ?? result) as T
}

type AutoClaimRule = { enabled: boolean, severityMin: string, kinds: string[], apps: string[] }

// 自动领取规则优先读项目设置（webdev_issue_settings），失败时回退环境变量默认值
async function loadAutoClaimRule(event: Parameters<typeof dataRuntimeFetch>[0]): Promise<AutoClaimRule> {
  try {
    const settings = unwrap<{ autoClaimEnabled?: boolean, severityMin?: string, kinds?: string[], apps?: string[] }>(
      await dataRuntimeFetch(event, '/v1/webdev/issues/settings')
    )
    return {
      enabled: settings.autoClaimEnabled !== false,
      severityMin: settings.severityMin || 'high',
      kinds: settings.kinds?.length ? settings.kinds : ['bug'],
      apps: settings.apps?.length ? settings.apps : envAutoClaimApps()
    }
  } catch {
    return { enabled: true, severityMin: 'high', kinds: ['bug'], apps: envAutoClaimApps() }
  }
}

export default defineEventHandler(async (event): Promise<unknown> => {
  // 来源应用与租户只信任 service token claim（中间件已校验）
  const ctx = await requireWebDevService(event, ['webdev:issue:write', 'webdev:write'])
  const appCode = String(ctx?.appCode || '').trim()
  const tenant = String(ctx?.tenant || '').trim()

  const body = await readBody(event)
  const input = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}

  const title = String(input.title || '').trim()
  if (!title) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }

  const scope = input.scope === 'app' ? 'app' : 'page'
  const routePattern = String(input.routePattern || '').trim()
  const pageKey = scope === 'page' && routePattern ? `${appCode}:${routePattern}` : ''

  const created = unwrap<{ id?: string, severity?: string, kind?: string }>(
    await dataRuntimeFetch(event, '/v1/webdev/issues', {
      method: 'POST',
      body: {
        appCode,
        tenant,
        repoId: appRepo(appCode),
        scope,
        pageKey,
        pageUrl: redactUrl(input.pageUrl),
        severity: normSeverity(input.severity),
        kind: normKind(input.kind),
        title,
        description: String(input.description || ''),
        reporterUid: String(input.reporterUid || ''),
        reporterName: String(input.reporterName || ''),
        fingerprint: String(input.fingerprint || ''),
        context: input.context,
        source: 'reporter'
      }
    })
  )

  const issueId = String(created.id || '')

  // 自动领取（命中规则才执行；best-effort，不影响上报成功）
  const rule = await loadAutoClaimRule(event)
  const sev = normSeverity(created.severity ?? input.severity)
  const knd = normKind(created.kind ?? input.kind)
  if (issueId
    && rule.enabled
    && (SEVERITY_RANK[sev] ?? 2) >= (SEVERITY_RANK[rule.severityMin] ?? 3)
    && rule.kinds.includes(knd)
    && rule.apps.includes(appCode)) {
    try {
      await claimIssueAndCreateJob(event, issueId, { actor: 'system', autoClaimed: true })
    } catch (error) {
      console.warn('[webdev] auto-claim skipped', error)
    }
  }

  return unwrap(await dataRuntimeFetch(event, `/v1/webdev/issues/${encodeURIComponent(issueId)}`))
})
