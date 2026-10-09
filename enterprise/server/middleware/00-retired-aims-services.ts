import { createError, defineEventHandler, getRequestURL } from 'h3'

// Denial-only compatibility boundary; this is not a delegated Host operation.
export default defineEventHandler((event) => {
  if (getRequestURL(event).pathname !== '/aims/api/v1/service/tasks') return
  throw createError({
    statusCode: 410,
    message: '旧任务服务接口已退役，请使用 Enterprise 工作项页面',
    data: { code: 'aims_service_tasks_retired' }
  })
})
