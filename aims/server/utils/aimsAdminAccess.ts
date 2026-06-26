import type { H3Event } from 'h3'
import { checkPermission, checkRole } from './checkPermission'

export async function hasAimsSystemManageAccess(event: H3Event) {
  return await checkPermission(event, 'projects', 'admin')
    || await checkPermission(event, 'project_templates', 'admin')
    || await checkPermission(event, 'admin', 'admin')
    || await checkRole(event, 'system_admin')
    || await checkRole(event, 'platform:admin')
    || await checkRole(event, 'super_admin')
    || await checkRole(event, 'aims:admin')
    || await checkRole(event, 'assets:admin')
    || await checkRole(event, 'assets:product-admin')
    || await checkRole(event, 'assets:product-manager')
    || await checkRole(event, 'console:admin')
    || await checkRole(event, 'console:console-dev-admin')
}
