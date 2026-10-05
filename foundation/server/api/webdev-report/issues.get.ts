import { createError } from 'h3'

// 报告组件「我已提报」列表：按当前用户 + 层级过滤，供提交前自行判断是否重复。
export default defineEventHandler(async (event): Promise<unknown> => {
  const auth = await resolveConsoleAuthWithSessionBridge(event)
  if (!auth.authenticated || !auth.uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const query = getQuery(event)
  return await listMyWebDevIssues(event, {
    reporterUid: auth.uid,
    scope: typeof query.scope === 'string' ? query.scope : undefined,
    routePattern: typeof query.routePattern === 'string' ? query.routePattern : undefined,
    pageSize: typeof query.pageSize === 'string' ? query.pageSize : undefined
  })
})
