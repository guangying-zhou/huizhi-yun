// Browser-facing error contract for Enterprise Host business APIs.
//
// The Host server (managed cloud / self-hosted, passed through unchanged by
// their gateways) and the hzy0 local gateway render the same shape: HTTP
// status, a stable snake_case machine `code` produced by the Host/Runtime
// contract, and a fixed per-status message. Upstream messages, details,
// addresses and tokens never reach the browser; pages map `code` to their own
// wording and fall back to the fixed message.

const machineCode = /^[a-z][a-z0-9]{0,23}(?:_[a-z0-9]{1,24}){0,11}$/

/** A stable machine code, or '' when the value is not a bounded snake_case identifier. */
export function safeEnterpriseErrorCode(value: unknown): string {
  return typeof value === 'string' && value.length <= 64 && machineCode.test(value) ? value : ''
}

const statusMessages: Readonly<Record<number, string>> = Object.freeze({
  400: '请求参数无效',
  401: '请先登录',
  403: '权限不足',
  404: '资源不存在',
  409: '请求与当前业务状态冲突，请刷新后重试',
  410: '资源已失效',
  412: '前置条件不满足，请刷新后重试',
  413: '请求内容过大',
  422: '请求内容无法处理',
  429: '请求过于频繁，请稍后重试'
})

/** Fixed, non-diagnostic message for an HTTP error status. */
export function enterpriseErrorMessage(status: number): string {
  return statusMessages[status] || (status >= 500 ? '服务暂时不可用，请稍后重试' : '请求失败')
}

/** 4xx statuses whose Runtime/Host machine code is a business outcome pages may explain. */
export const enterpriseBusinessErrorStatuses: ReadonlySet<number> = new Set([400, 409, 410, 412, 422])
