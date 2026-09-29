import { createError, type H3Event } from 'h3'
import { callEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadProjectWriteAuthorization } from '@hzy/foundation/server/utils/projectWriteAuthorization'
import { resolveAimsProjectAuthorizationObject } from '../../../aims/server/utils/aimsScopedAuthorization'
import { enterpriseAimsProjectReadPermit } from './enterpriseAimsProjects'

export async function enterpriseAimsProjectWriteAuthorization(
  event: H3Event,
  user: { uid: string, tenant: string, deployment: string },
  projectId: string,
  target: { resource: 'projects', action: 'edit' } | { resource: 'project-members', action: 'add' | 'role' | 'remove' }
) {
  const permit = await enterpriseAimsProjectReadPermit(event, user)
  const project = await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, 'aims.project-view', {
    tenant: user.tenant, deployment: user.deployment, projectId, ...permit
  })
  if (project.code !== 0) throw createError({ statusCode: 503, message: '项目授权事实不完整' })
  const object = await resolveAimsProjectAuthorizationObject(event, { projectId, uid: user.uid }, async () => project.data)
  return await loadProjectWriteAuthorization(event, user, projectId, object, target)
}
