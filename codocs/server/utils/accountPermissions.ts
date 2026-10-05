import type { UserPermissionsData } from '~/types/account'

export async function getUserPermissions(uid: string): Promise<UserPermissionsData | null> {
  const normalizedUid = String(uid || '').trim()
  if (!normalizedUid) return null

  console.warn('[AccountPermissions] getUserPermissions requires request-scoped Console authorization and is no longer backed by a local policy bundle')
  return null
}

export async function hasAccountRole(uid: string, roleCode: string) {
  const permissions = await getUserPermissions(uid)
  if (!permissions?.roles?.length) return false
  return permissions.roles.some(role => role.code === roleCode)
}

export async function requireAccountRole(uid: string, roleCode: string, message = '权限不足') {
  const normalizedUid = String(uid || '').trim()
  if (!normalizedUid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const allowed = await hasAccountRole(normalizedUid, roleCode)
  if (!allowed) {
    throw createError({ statusCode: 403, message })
  }
}

export async function getRoleMemberUids(roleCode: string) {
  console.warn(`[AccountPermissions] getRoleMemberUids(${roleCode}) no longer reads local policy bundle; use Console authorization directory API`)
  return []
}
