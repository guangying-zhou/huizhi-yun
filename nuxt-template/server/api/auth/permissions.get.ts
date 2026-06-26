interface PermissionsResponse {
  code: number
  data: {
    uid: string
    roles: string[]
    resources: Record<string, unknown>
  }
}

export default defineEventHandler(async (event): Promise<PermissionsResponse> => {
  const uid = getCookie(event, 'hzy_uid') || getCookie(event, 'auth_user')
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  return {
    code: 0,
    data: { uid, roles: [], resources: {} }
  }
})
