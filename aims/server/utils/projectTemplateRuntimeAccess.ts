import type { H3Event } from 'h3'
import { hasAimsSystemManageAccess } from './aimsAdminAccess'

export async function buildProjectTemplateAdminRuntimeQuery(event: H3Event) {
  return {
    current_user_is_project_admin: await hasAimsSystemManageAccess(event) ? '1' : '0'
  }
}
