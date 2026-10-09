/** Missing optional B5 storage stays an unavailable feature, not an empty list. */
export function tenderReadFailure(error: unknown) {
  const failure = error as { status?: number, statusCode?: number, response?: { status?: number } } | null
  const unavailable = (failure?.statusCode || failure?.status || failure?.response?.status) === 503
  return { unavailable, message: unavailable ? '投标功能暂不可用，请联系管理员完成模块安装后重试。' : '投标资料加载失败，请重试。' }
}
