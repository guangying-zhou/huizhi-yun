import { getHeader, type H3Event } from 'h3'

/**
 * 跨应用调用时向目标应用转发的受信上下文 header。
 *
 * **这是唯一的定义处。业务模块不得再自建白名单。**
 *
 * 走查 ISSUE-B-025：此前 altoc / finance 各自散落着三份互不一致的转发实现——
 *
 * | 实现 | header 数 | 含 runtime 定位 |
 * | --- | --- | --- |
 * | `activate-delivery.post.ts`              | 15 | 6 个 |
 * | `serviceTicketOpsKnowledgeOperation.ts`  |  5 | 0 个（开票申请走这条） |
 * | `altocFinanceSummaryOperation.ts`        |  1 | 0 个（Finance 回写走这条） |
 *
 * 后果：Altoc 的入站请求本来带着完整的 `x-hzy-data-runtime-*` 定位信息
 * （生产 tail 实测），但开票申请那条转发时把它们丢了。目标应用因此拿不到租户
 * runtime 的地址与凭据，其入站服务令牌 introspection 只能返回
 * `503 service_token_introspection_unavailable`，整条跨应用调用失败。
 *
 * 谁少转发谁静默失败，且症状完全一样（笼统 503），极难定位。因此白名单必须
 * 集中一处，并由契约测试禁止各模块自建。
 *
 * 信任边界说明：这些值由 Tenant Gateway 注入给业务应用，转发给同信任域内的
 * 目标应用与 Console 属上下文传递，不扩大对外暴露面。但**不得回传浏览器**，
 * 也不得转发给信任域外的第三方。
 */
const CROSS_APP_FORWARDED_HEADERS = [
  // 受信网关身份与租户/部署上下文
  'x-hzy-gateway',
  'x-hzy-gateway-token',
  'x-hzy-tenant',
  'x-hzy-deployment',
  'x-hzy-environment',
  // 网关注入的服务路由目录：目标应用继续做链式跨应用调用（如 finance -> workflow）
  // 时需要它解析下一跳的目标上下文
  'x-hzy-service-routes',
  // 租户 runtime 定位与凭据：目标应用校验入站服务令牌时必须能据此到达租户 runtime
  'x-hzy-tenant-runtime-url',
  'x-hzy-tenant-runtime-token',
  'x-hzy-tenant-runtime-audience',
  'x-hzy-data-runtime-url',
  'x-hzy-data-runtime-token',
  'x-hzy-data-runtime-audience',
  'x-hzy-data-runtime-code',
  // 原始请求定位，供目标应用推导自身对外地址
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-prefix',
  'x-forwarded-proto'
] as const

export const crossAppForwardedHeaderNames: readonly string[] = CROSS_APP_FORWARDED_HEADERS

function text(value: unknown) {
  return String(value || '').trim()
}

export interface CrossAppForwardedHeaderOptions {
  /** 跨应用写操作的幂等键，会写入 `idempotency-key`。 */
  idempotencyKey?: string
  /** 额外 header，最后合并，可覆盖上面的取值。 */
  extra?: Record<string, string>
}

/**
 * 从当前请求提取跨应用调用需要的受信上下文。
 *
 * 注意：`x-hzy-app-code` / `x-hzy-deployment` / `x-forwarded-prefix` 是**目标上下文**
 * 三字段，由 `serviceAppFetch` 依据网关的 `x-hzy-service-routes` 目录原子改写为目标
 * 应用的值（根 CLAUDE.md 约束）。本白名单里的 deployment/prefix 只是原样透传的
 * 缺省值，发送前一定会被 `applyTargetAppContext` 覆盖或剥除。
 */
export function crossAppForwardedHeaders(
  event: H3Event | null | undefined,
  options: CrossAppForwardedHeaderOptions = {}
): Record<string, string> {
  const headers: Record<string, string> = {}
  if (event) {
    for (const name of CROSS_APP_FORWARDED_HEADERS) {
      const value = text(getHeader(event, name))
      if (value) headers[name] = value
    }
    const requestId = text(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
    if (requestId) headers['x-request-id'] = requestId
  }

  const idempotencyKey = text(options.idempotencyKey)
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey

  return { ...headers, ...(options.extra || {}) }
}
