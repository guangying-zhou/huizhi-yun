/** Safe UI copy only; the owning handler remains the authorization boundary. */
export function projectPageFailure(error: unknown, fallback = '项目数据暂不可用，请稍后重试'): string {
  const failure = error as { statusCode?: number, status?: number, response?: { status?: number } } | null
  const status = failure?.statusCode || failure?.status || failure?.response?.status
  if (status === 401) return '登录状态已失效，请重新登录'
  if (status === 403) return '你没有访问此项目内容的权限，请联系项目经理或返回项目总览'
  if (status === 404) return '内容不存在或已移除，请返回列表确认'
  if (status === 410) return '此旧入口已下线，请从项目总览使用现有功能'
  return fallback
}
