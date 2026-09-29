import { createError, getQuery, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

function responseData(value: unknown) {
  return value && typeof value === 'object' && 'data' in value ? (value as { data?: unknown }).data : undefined
}

export async function enterpriseCodocsTransferTargets(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const query = getQuery(event)
  const target = query.target
  if (Object.keys(query).length !== 1 || (target !== 'department' && target !== 'project')) {
    throw createError({ statusCode: 400, message: '移交目标请求无效' })
  }

  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', 'edit', snapshot.actionPolicies?.documents)) {
    throw createError({ statusCode: 403, message: '缺少文档移交权限' })
  }
  await prepareEnterpriseRuntime(event, `codocs.document-transfer-${target}`)
  const directoryOperation = target === 'department' ? 'console.directory-self-departments' : 'console.directory-self-projects'
  await prepareEnterpriseRuntime(event, directoryOperation)

  try {
    if (target === 'department') {
      const departments = responseData(await callEnterpriseRuntime(event, directoryOperation, {})) as { departments?: unknown, primaryDeptCode?: unknown } | undefined
      if (!departments || !Array.isArray(departments.departments) || (departments.primaryDeptCode !== null && typeof departments.primaryDeptCode !== 'string')) {
        throw new Error('invalid department projection')
      }
      return { code: 0, data: { departments: departments.departments, primaryDeptCode: departments.primaryDeptCode } }
    }
    const projects = responseData(await callEnterpriseRuntime(event, directoryOperation, {})) as { managed?: unknown, joined?: unknown } | undefined
    if (!projects || !Array.isArray(projects.managed) || !Array.isArray(projects.joined)) {
      throw new Error('invalid project projection')
    }
    return { code: 0, data: { managed: projects.managed, joined: projects.joined } }
  } catch {
    throw createError({ statusCode: 503, message: '移交目标目录暂不可用' })
  }
}
