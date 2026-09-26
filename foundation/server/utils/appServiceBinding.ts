import { createError, type H3Event } from 'h3'
import {
  cloudflareEnvFromEvent,
  CONSOLE_WORKER_USER_AGENT,
  type CloudflareServiceBinding
} from './consoleServiceBinding'
import { resolveTrustedServiceAppRoute } from './serviceAppUrl'

/**
 * 业务应用之间的 Service Binding 解析与调用。
 *
 * 为什么必须走 Service Binding —— 与 Console 完全同因（见 `consoleServiceBinding.ts`）：
 * 托管云 Worker 用租户公网地址调另一个应用 Worker 会重新进入公共边缘和 WAF。
 * 生产 zone `huizhi.yun` 的 `CN_CA_JP` 规则会 block 掉
 * `ip.src.country ∉ {CA, CN, JP}` 的请求，而 Worker 子请求没有访客上下文、
 * 被归属为 `country=US`，于是稳定失败。Service Binding 是 Worker 间直连，
 * 不经过边缘，不受任何 WAF/地理规则影响。
 *
 * 走查 ISSUE-B-024：此前只有 `HZY_CONSOLE_SERVICE` 一条绑定，应用之间一律走
 * `https://{租户网关}/{app}/` 公网地址。生产实测的后果是：
 *   - 浏览器 POST 该地址 → 正常路由到目标应用并返回 401（要求服务令牌）
 *   - Altoc Worker POST 同一地址 → 目标 Worker 零入站，且**不报错**
 *   - operation 停在 processing、既不 succeed 也不 fail，成为孤儿
 * 由此 `contract_orchestration_job`、两侧 `integration_operation`、
 * `finance_reconciliation` 在生产长期为 0 —— 跨应用主线从未跑通过。
 */

export type AppServiceBindingName = `HZY_${string}_SERVICE`

function normalizeAppCode(value: string) {
  return String(value || '').trim().toLowerCase()
}

/**
 * `altoc` -> `HZY_ALTOC_SERVICE`。与 Cloudflare 配置渲染器生成的 binding 名一致。
 */
export function appServiceBindingName(appCodeInput: string): AppServiceBindingName | '' {
  const appCode = normalizeAppCode(appCodeInput)
  if (!appCode || !/^[a-z][a-z0-9-]*$/.test(appCode)) return ''
  return `HZY_${appCode.replace(/-/g, '_').toUpperCase()}_SERVICE`
}

export function appServiceBinding(
  event: H3Event | null | undefined,
  appCodeInput: string
): CloudflareServiceBinding | null {
  const name = appServiceBindingName(appCodeInput)
  if (!name) return null
  const candidate = cloudflareEnvFromEvent(event)[name] as Partial<CloudflareServiceBinding> | undefined
  return candidate && typeof candidate.fetch === 'function'
    ? candidate as CloudflareServiceBinding
    : null
}

/**
 * Service Binding 直达目标 Worker 时的 URL 处理。
 *
 * **默认不剥 `/{app}` 前缀。** Console 的 `normalizeConsoleServiceBindingUrl` 会剥
 * `/console`，那是因为 Console Worker 的 `HZY_APP_BASE_PATH` 是 `/`，它自身路由里
 * 不含该前缀。业务应用不同：Finance 的 base path 就是 `/finance/`，Worker 期望收到
 * `/finance/api/v1/finance/...`。
 *
 * 生产实测（直连 workers.dev，等价于 Service Binding 路径）：
 *   POST /api/v1/finance/service/invoice-requests/create          -> 302（未匹配路由）
 *   POST /finance/api/v1/finance/service/invoice-requests/create  -> 401（正确匹配，要求令牌）
 *
 * 因此这里只在调用方显式告知目标 base path 为根时才剥前缀；默认原样透传。
 * 把 Console 的特例当通例会让请求打到目标 Worker 上却匹配不到任何路由。
 */
export function normalizeAppServiceBindingUrl(
  input: string | URL,
  appCodeInput: string,
  options: { targetBasePath?: string } = {}
) {
  const appCode = normalizeAppCode(appCodeInput)
  const value = input instanceof URL ? new URL(input.toString()) : new URL(input)
  if (!appCode) return value.toString()

  // 只有调用方**显式**声明目标挂在根路径时才剥前缀。未声明一律原样透传，
  // 否则会把业务应用（base path 为 /{app}/）的请求打成匹配不到路由的 302。
  const targetBasePath = String(options.targetBasePath || '').trim()
  if (targetBasePath !== '/') return value.toString()

  const prefix = `/${appCode}`
  if (value.pathname === prefix) {
    value.pathname = '/'
  } else if (value.pathname.startsWith(`${prefix}/`)) {
    value.pathname = value.pathname.slice(prefix.length)
  }
  return value.toString()
}

export interface ServiceAppFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  timeout?: number
  /**
   * 目标应用自身的 base path。只有为 `/` 时才剥掉租户网关的 `/{app}` 前缀。
   * 业务应用默认挂在 `/{app}/`，不传即按原样透传。
   */
  targetBasePath?: string
}

function jsonBody(body: unknown) {
  if (body === undefined || body === null) return undefined
  if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body as BodyInit
  if (typeof body === 'string') return body
  return JSON.stringify(body)
}

/**
 * 跨应用 HTTP 调用的统一入口。
 *
 * 有 Service Binding 就直连目标 Worker；没有（自托管、单租户、本地开发）才回落公网。
 * 两条路径的错误形状保持一致：非 2xx 一律抛带 `statusCode` 与 `data` 的错误，
 * 使 `extractServiceOperationStatus` / `classifyServiceOperationFailure` 能正常分类，
 * 避免跨应用失败又一次被降级成静默 pending。
 */
export async function serviceAppFetch<T>(
  event: H3Event | null | undefined,
  appCodeInput: string,
  url: string,
  options: ServiceAppFetchOptions = {}
): Promise<T> {
  const appCode = normalizeAppCode(appCodeInput)
  const method = (options.method || 'GET').toUpperCase()
  const timeoutMs = options.timeout ?? 10000
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(options.headers || {})
  }
  applyTargetAppContext(headers, event, appCode)
  const payload = jsonBody(options.body)
  if (payload !== undefined && typeof payload === 'string' && !Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) {
    headers['content-type'] = 'application/json'
  }

  const binding = appServiceBinding(event, appCode)
  if (binding) {
    const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined
    const bound = await binding.fetch(normalizeAppServiceBindingUrl(url, appCode, {
      targetBasePath: options.targetBasePath
    }), {
      method,
      headers,
      ...(payload === undefined ? {} : { body: payload }),
      ...(signal ? { signal } : {})
    })
    const data = await bound.json().catch(() => undefined)
    if (!bound.ok) {
      throw createError({
        statusCode: bound.status,
        statusMessage: bound.statusText || undefined,
        message: recordMessage(data) || bound.statusText || `${appCode} service API request failed`,
        data
      })
    }
    return data as T
  }

  // 公网回落：仍带上 WAF bypass 判据用的 UA，行为与 Console 侧一致。
  const appFetch = $fetch as unknown as (
    input: string,
    init: { method: string, headers: Record<string, string>, body?: unknown, timeout: number }
  ) => Promise<T>
  return await appFetch(url, {
    method,
    headers: { 'user-agent': CONSOLE_WORKER_USER_AGENT, ...headers },
    ...(options.body === undefined ? {} : { body: options.body }),
    timeout: timeoutMs
  })
}

function recordMessage(value: unknown) {
  if (!value || typeof value !== 'object') return ''
  const record = value as { message?: unknown, statusMessage?: unknown }
  const message = record.message ?? record.statusMessage
  return typeof message === 'string' ? message : ''
}

const TARGET_CONTEXT_HEADERS = ['x-hzy-app-code', 'x-hzy-deployment', 'x-forwarded-prefix'] as const

function deleteHeaderCaseInsensitive(headers: Record<string, string>, name: string) {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) Reflect.deleteProperty(headers, key)
  }
}

/**
 * 跨 Worker 直达目标应用时，原子改写目标上下文三字段（根 CLAUDE.md 的硬性约束）：
 * `x-hzy-app-code`、`x-hzy-deployment`、`x-forwarded-prefix` 必须一致指向**目标**应用。
 *
 * 为什么缺一不可（走查 ISSUE-B-025 生产实测的完整因果）：
 *
 * - 目标应用向 Console 换取自身 runtime 令牌时，`runtimeAppIdentity` 的判据是
 *   受信网关上下文里的 `appCode === 自身 appCode`（serviceOidc.ts）。业务 Worker 没有
 *   service client secret，这是它唯一的换牌途径。app-code 缺失或仍是来源应用，
 *   目标端一律 503 "Console service client is not configured."。
 * - deployment 保留来源值会让目标端以错误的部署身份访问 runtime，并污染
 *   integration_operation / receipt 的幂等域（二者的唯一性都含 deployment_code）。
 * - forwarded-prefix 保留来源值会让目标端推导出错误的自身路径。
 *
 * 目标上下文来自 Tenant Gateway 注入的 `x-hzy-service-routes` 受信目录
 * （resolveTrustedServiceAppRoute 校验网关身份后解析）。目录不可用时（自托管 /
 * 本地开发 / 老网关），三字段一律剥除——宁可让目标端回落自身 env 配置，
 * 也不能带着来源应用的上下文冒充。
 */
function applyTargetAppContext(
  headers: Record<string, string>,
  event: H3Event | null | undefined,
  appCodeInput: string
) {
  const appCode = normalizeAppCode(appCodeInput)
  for (const name of TARGET_CONTEXT_HEADERS) deleteHeaderCaseInsensitive(headers, name)
  if (!event || !appCode) return

  let route: ReturnType<typeof resolveTrustedServiceAppRoute> = null
  try {
    route = resolveTrustedServiceAppRoute(event, appCode)
  } catch {
    // 运行环境没有 Nitro runtime config（如独立测试进程）时按目录不可用处理：
    // 三字段保持剥除状态，绝不猜测目标上下文。
    route = null
  }
  if (!route) return

  headers['x-hzy-app-code'] = appCode
  headers['x-hzy-deployment'] = route.deploymentCode
  // 网关注入格式为无尾斜杠（实测 '/altoc'）；目录 basePath 形如 '/finance/'。
  const prefix = route.basePath.replace(/\/+$/, '')
  headers['x-forwarded-prefix'] = prefix || `/${appCode}`
}
