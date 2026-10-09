import { createError } from 'h3'
import { extractServiceOperationCode, extractServiceOperationStatus } from '@hzy/foundation/server/utils/serviceOperation'

// Preserve terminal business failures in Runtime envelopes. Converting a
// revision conflict to 503 would repeatedly replay an obsolete frozen command.
export function productCostRuntimeError(envelope: unknown) {
  const upstream = extractServiceOperationStatus(envelope)
  const code = extractServiceOperationCode(envelope, upstream)
  const statusCode = upstream && [400, 401, 403, 404, 409, 422, 429].includes(upstream) ? upstream : 503
  return createError({
    statusCode,
    message: code === 'product_cost_revision_conflict'
      ? '分摊规则已被修改，请重新读取后提交'
      : statusCode === 403 ? '无权执行项目成本操作' : '项目成本操作未完成',
    data: { code, upstreamStatus: statusCode }
  })
}
