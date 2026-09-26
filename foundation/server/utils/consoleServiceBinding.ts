import { createError, type H3Event } from 'h3'

/**
 * Console Service Binding 解析。
 *
 * 独立成模块是为了打破循环依赖：`serviceOidc.ts` 导入 `consoleRuntime.ts` 取 tokenUrl，
 * 而 `consoleRuntime.ts` 也需要 Service Binding 才能安全访问 Console。
 *
 * 为什么必须走 Service Binding：托管云 Worker 用公网地址回调 Console 会重新进入
 * 公共边缘和 WAF。生产 zone `huizhi.yun` 上的 `CN_CA_JP` 规则会 block 掉
 * `ip.src.country ∉ {CA, CN, JP}` 的请求，而 **cron 触发的 Worker 子请求没有访客上下文、
 * 被归属为 `country=US`**，于是稳定 403；浏览器触发的子请求因为继承访客国家反而能通过。
 * 该规则的 bypass 例外只覆盖 `wiztek-data-runtime.huizhi.yun`。
 * Service Binding 是 Worker 间直连，根本不经过边缘，因此不受任何 WAF/地理规则影响。
 */

type CloudflareEnv = Record<string, unknown>

export type CloudflareServiceBinding = {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

type CloudflareRuntimeEvent = H3Event & {
  context?: H3Event['context'] & {
    cloudflare?: { env?: CloudflareEnv }
    _platform?: { cloudflare?: { env?: CloudflareEnv } }
  }
  req?: { runtime?: { cloudflare?: { env?: CloudflareEnv } } }
}

/**
 * 少数仍需走公网的 Console 调用必须带上该 UA：生产 WAF bypass 规则以它作为
 * 可信内部 Worker 的判据。缺失会被 `CN_CA_JP` 规则拦成 403。
 */
export const CONSOLE_WORKER_USER_AGENT = 'HZY-Cloudflare-Worker/1.0'

export function cloudflareEnvFromEvent(event?: H3Event | null): CloudflareEnv {
  if (!event) return {}
  const runtimeEvent = event as CloudflareRuntimeEvent
  return runtimeEvent.context?.cloudflare?.env
    || runtimeEvent.context?._platform?.cloudflare?.env
    || runtimeEvent.req?.runtime?.cloudflare?.env
    || {}
}

export function consoleServiceBinding(event?: H3Event | null): CloudflareServiceBinding | null {
  // A server-installed local transport is not derived from request headers or
  // runtimeConfig.public. Workers continue to use their actual Service Binding.
  const local = event?.context?.hzyConsoleTransport as Partial<CloudflareServiceBinding> | undefined
  if ((process.env.HZY0_LOCAL_ENTERPRISE === 'true' || process.env.HZY0_WORKFLOW_LOCAL_ONLY === 'true')
    && local && typeof local.fetch === 'function') return local as CloudflareServiceBinding
  const candidate = cloudflareEnvFromEvent(event).HZY_CONSOLE_SERVICE as Partial<CloudflareServiceBinding> | undefined
  return candidate && typeof candidate.fetch === 'function'
    ? candidate as CloudflareServiceBinding
    : null
}

/**
 * Service Binding 直达 Console Worker，必须去掉租户网关的 `/console` 前缀。
 */
export function normalizeConsoleServiceBindingUrl(input: string | URL) {
  const value = input instanceof URL ? new URL(input) : new URL(input)
  if (value.pathname === '/console') {
    value.pathname = '/'
  } else if (value.pathname.startsWith('/console/')) {
    value.pathname = value.pathname.slice('/console'.length)
  }
  return value.toString()
}

export interface ConsoleServiceFetchOptions {
  method?: string
  headers?: Record<string, string>
  params?: Record<string, unknown>
  body?: unknown
  timeout?: number
  retry?: number
}

/**
 * 托管云业务 Worker 访问 Console HTTP API 的统一入口。
 *
 * 有 `HZY_CONSOLE_SERVICE` 绑定就走 Worker 间私有直连；没有（自托管、单租户、
 * 本地开发）才回落公网并带上 Worker UA。
 *
 * 为什么必须走绑定（根 CLAUDE.md 的硬性约束）：Worker 子请求没有访客国家上下文，
 * 会被生产 zone 的 `CN_CA_JP` 规则判为 `country=US` 并在到达 Console 之前拦掉，
 * 返回 403 和一段 HTML 拦截页。
 *
 * 走查 ISSUE-B-025 实测：workflow 在审批入站里调 Console directory users 时
 * 用的是普通 `$fetch`，于是
 * `[GET] https://console.huizhi.yun/api/v1/console/service/directory/users` 恒 403，
 * 整条 Finance -> Workflow 审批链因此永久失败。
 */
export async function consoleServiceFetch<T>(
  event: H3Event | null | undefined,
  url: string,
  options: ConsoleServiceFetchOptions = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase()
  const timeoutMs = options.timeout ?? 10000
  const target = new URL(url)
  for (const [key, value] of Object.entries(options.params || {})) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) target.searchParams.append(key, String(item))
      }
      continue
    }
    target.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = { accept: 'application/json', ...(options.headers || {}) }
  const payload = options.body === undefined || options.body === null
    ? undefined
    : typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
  if (payload !== undefined && !Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) {
    headers['content-type'] = 'application/json'
  }

  const binding = consoleServiceBinding(event)
  if (binding) {
    const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined
    const bound = await binding.fetch(normalizeConsoleServiceBindingUrl(target), {
      method,
      headers,
      ...(payload === undefined ? {} : { body: payload }),
      ...(signal ? { signal } : {})
    })
    const data = await bound.json().catch(() => undefined)
    if (!bound.ok) {
      const record = (data && typeof data === 'object' ? data : {}) as { message?: unknown }
      throw createError({
        statusCode: bound.status,
        statusMessage: bound.statusText || undefined,
        message: typeof record.message === 'string' ? record.message : (bound.statusText || 'Console API request failed'),
        data
      })
    }
    return data as T
  }

  const publicFetch = $fetch as unknown as (input: string, init: {
    method: string
    headers: Record<string, string>
    body?: unknown
    timeout: number
    retry?: number
  }) => Promise<T>
  return await publicFetch(target.toString(), {
    method,
    headers: { 'user-agent': CONSOLE_WORKER_USER_AGENT, ...headers },
    ...(options.body === undefined ? {} : { body: options.body }),
    timeout: timeoutMs,
    ...(options.retry === undefined ? {} : { retry: options.retry })
  })
}
