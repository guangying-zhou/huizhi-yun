import { getCookie, getHeader, getQuery, type H3Event } from 'h3'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function queryValue(value: unknown) {
  return stringValue(Array.isArray(value) ? value[0] : value)
}

export const ACTIVE_ENTERPRISE_ROLE_COOKIE = 'hzy_active_enterprise_role'

export function activeRoleCookieName(_appCode?: string) {
  return ACTIVE_ENTERPRISE_ROLE_COOKIE
}

export function resolveActiveRoleCode(event: H3Event | undefined, appCode: string) {
  if (!event) return ''

  const query = getQuery(event)
  return queryValue(query.activeRoleCode)
    || queryValue(query.roleCode)
    || stringValue(getHeader(event, 'x-hzy-active-role'))
    || stringValue(getCookie(event, activeRoleCookieName(appCode)))
    || stringValue(getCookie(event, 'hzy_active_role'))
}

export function activeRolePermissionQuery(event: H3Event | undefined, appCode: string) {
  const activeRoleCode = resolveActiveRoleCode(event, appCode)
  return activeRoleCode
    ? { appCode, activeRoleCode }
    : { appCode }
}
