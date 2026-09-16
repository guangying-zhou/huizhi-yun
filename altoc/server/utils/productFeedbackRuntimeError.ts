import { createError } from 'h3'
import { extractServiceOperationCode, extractServiceOperationStatus } from '@hzy/foundation/server/utils/serviceOperation'

// Preserve permanent binding/revision failures so frozen commands do not retry
// forever. Raw target diagnostics are not part of the service response.
export function productFeedbackRuntimeError(envelope: unknown) {
  const upstream = extractServiceOperationStatus(envelope)
  const code = extractServiceOperationCode(envelope, upstream)
  const statusCode = upstream && [400, 401, 403, 404, 409, 422, 429].includes(upstream) ? upstream : 503
  return createError({ statusCode, message: '产品反馈回流未完成', data: { code, upstreamStatus: statusCode } })
}
