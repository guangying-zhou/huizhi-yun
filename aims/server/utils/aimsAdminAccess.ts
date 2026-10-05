import type { H3Event } from 'h3'
import { checkPermission, requirePermission } from './checkPermission'

export async function hasAimsAdminRoleAccess(event: H3Event) {
  return await checkPermission(event, 'admin', 'admin')
}

export async function requireAimsAdminRoleAccess(
  event: H3Event,
  message = '仅 AIMS 管理员可以访问系统管理'
) {
  await requirePermission(event, 'admin', 'admin', message)
}

export async function requireAimsProjectManageAccess(
  event: H3Event,
  message = '需要 AIMS 项目管理权限才可以访问项目管理'
) {
  if (await checkPermission(event, 'projects', 'admin')) return
  await requirePermission(event, 'admin', 'admin', message)
}

export async function requireAimsProjectDeleteAccess(
  event: H3Event,
  message = '仅系统管理员可以彻底删除项目'
) {
  await requirePermission(event, 'admin', 'admin', message)
}

export async function hasAimsSystemManageAccess(event: H3Event) {
  return await checkPermission(event, 'project_templates', 'admin')
    || await checkPermission(event, 'admin', 'admin')
}
