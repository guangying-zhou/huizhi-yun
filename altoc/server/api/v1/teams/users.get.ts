/**
 * 获取可选用户列表。
 */

interface DirectoryUser {
  uid?: string
  realName?: string
  real_name?: string
  deptName?: string
  department?: {
    name?: string
  }
}

function normalizeDirectoryUsers(payload: unknown): DirectoryUser[] {
  if (Array.isArray(payload)) return payload as DirectoryUser[]
  if (payload && typeof payload === 'object') {
    const record = payload as { items?: unknown, data?: unknown }
    if (Array.isArray(record.items)) return record.items as DirectoryUser[]
    if (Array.isArray(record.data)) return record.data as DirectoryUser[]
  }
  return []
}

export default defineEventHandler(async (event): Promise<{ code: number, message: string, data: unknown[] }> => {
  await requirePermission(event, 'admin', 'view')
  const query = getQuery(event)

  if (query.team_id) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Tenant runtime is required for sales team members.'
    })
  }

  try {
    const response = await fetchDirectoryApi<{ code: number, data?: unknown }>(
      '/api/v1/directory/users',
      {
        params: {
          pageSize: 200,
          search: query.keyword || ''
        }
      }
    )

    if (response.code === 0) {
      const users = normalizeDirectoryUsers(response.data)
      const seen = new Set<string>()
      const unique = users.filter((user) => {
        if (!user.uid || seen.has(user.uid)) return false
        seen.add(user.uid)
        return true
      })
      return {
        code: 0,
        message: 'ok',
        data: unique.map(user => ({
          uid: user.uid,
          real_name: user.realName || user.real_name,
          dept_name: user.department?.name || user.deptName
        }))
      }
    }
    return { code: 0, message: 'ok', data: [] }
  } catch {
    return { code: 0, message: 'ok', data: [] }
  }
})
