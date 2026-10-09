/**
 * 产品采用跨应用调用的失败归类。
 *
 * 产品采用要求两层授权：调用方 Aims 的产品查看权限（本地已判定），以及 Assets 侧
 * 对同一原用户的 deliveries / environments 数据范围。只有后者才是最终用户能自助
 * 申请的权限；服务令牌签发失败、服务身份或签名不匹配都是部署与授权配置问题，
 * 必须保持为 503，不得伪装成用户缺权的 403 让用户去申请权限。
 */

export type ProductAdoptionFailureReason
  = | 'assets_object_scope_denied'
    | 'product_adoption_service_rejected'
    | 'product_adoption_token_unavailable'
    | 'product_adoption_service_unavailable'

/** 形状即 `createError` 入参：`data.reason` 会随响应体返回，供页面区分提示。 */
export interface ProductAdoptionFailure {
  statusCode: number
  message: string
  data: { reason: ProductAdoptionFailureReason }
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** 上游错误体可能是 `{ reason }`，也可能是 h3 序列化后的 `{ data: { reason } }`。 */
export function productAdoptionUpstreamReason(error: unknown) {
  const body = record(record(error).data)
  const reason = record(body).reason ?? record(record(body).data).reason
  return typeof reason === 'string' ? reason : ''
}

export function productAdoptionUpstreamStatus(error: unknown) {
  const root = record(error)
  const status = Number(root.statusCode || root.status || record(root.response).status || 0)
  return Number.isSafeInteger(status) && status >= 100 && status <= 599 ? status : 0
}

/** Console 服务令牌不可用：与用户权限无关，保持可重试的 503 且不外泄诊断信息。 */
export function productAdoptionTokenFailure(): ProductAdoptionFailure {
  return {
    statusCode: 503,
    data: { reason: 'product_adoption_token_unavailable' },
    message: '产品采用服务授权暂不可用，请稍后重试；持续失败请检查 Aims → Assets 的服务授权。'
  }
}

export function productAdoptionServiceFailure(error: unknown): ProductAdoptionFailure {
  const status = productAdoptionUpstreamStatus(error)
  if (status === 403 && productAdoptionUpstreamReason(error) === 'assets_object_scope_denied') {
    return {
      statusCode: 403,
      data: { reason: 'assets_object_scope_denied' },
      message: '当前用户在 Assets 没有交付资产或环境的查看范围，无法查看产品采用。请为该用户配置 Assets deliveries:view 与 environments:view 及覆盖相关对象的数据范围。'
    }
  }
  if (status === 401 || status === 403) {
    // Assets 拒绝的是服务身份、来源应用或签名，不是这位用户的对象范围。
    return {
      statusCode: 503,
      data: { reason: 'product_adoption_service_rejected' },
      message: '产品采用服务调用未被 Assets 接受，请检查服务授权与部署绑定。'
    }
  }
  return {
    statusCode: 503,
    data: { reason: 'product_adoption_service_unavailable' },
    message: '产品采用服务响应无效'
  }
}
