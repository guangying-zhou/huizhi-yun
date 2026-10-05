import { createError, type H3Event } from 'h3'
import { resolvePeopleEmployeeAccessQuery } from '~~/server/utils/peopleScopedAuthorization'

// data-runtime 的员工相关路由用 requireEmployeeGlobalAccess 校验数据范围，
// 依据的是 query 里的 current_user_employee_access。
//
// 走 /api/v1/** 代理的请求由 tenant-runtime 中间件注入该参数；直接调用
// maybeCallTenantRuntime 的 /api/admin/** 端点必须自己解析并携带，
// 否则运行时看到空值一律 403 people_employee_access_denied。
export async function requirePeopleGlobalEmployeeScope(event: H3Event, actorUid: string) {
  const scoped = await resolvePeopleEmployeeAccessQuery(event, actorUid, 'admin', 'employees')
  if (String(scoped.current_user_employee_access || '') !== 'all') {
    throw createError({
      statusCode: 403,
      message: '该操作需要全部员工的数据范围权限。'
    })
  }
  return scoped
}
