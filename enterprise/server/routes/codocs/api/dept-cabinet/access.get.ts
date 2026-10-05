import { createError, setHeader } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { departmentCabinetAuthorize, departmentCabinetQuery } from '~~/server/utils/enterpriseCodocsDepartmentCabinet'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  const deptCode = departmentCabinetQuery(event, ['dept_code']).dept_code || ''
  const user = await departmentCabinetAuthorize(event, deptCode, 'view')
  await prepareEnterpriseRuntime(event, 'codocs.department-access-resolve')
  const result = await callEnterpriseRuntime(event, 'codocs.department-access-resolve', {
    tenant: user.tenant, deployment: user.deployment, code: deptCode,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'department-access', action: 'read', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }) as { success?: boolean, data?: { role?: string, canRead?: boolean, canWrite?: boolean, canManage?: boolean } }
  if (result?.success !== true || !result.data || typeof result.data.canRead !== 'boolean' || typeof result.data.canManage !== 'boolean') throw createError({ statusCode: 503, message: '部门权限状态不可用' })
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  const canEdit = authorizationResourcesAllow(snapshot.resources, 'departments', 'edit', snapshot.actionPolicies?.departments)
  return { code: 0, data: { ...result.data, canEdit } }
})
