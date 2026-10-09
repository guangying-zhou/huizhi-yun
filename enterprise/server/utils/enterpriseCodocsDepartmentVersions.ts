import { createError, getQuery, getRequestURL, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { codocsDepartmentCollaborationV2Enabled } from './enterpriseCodocsDepartmentCollaboration'
import { readVersionBody, rowsFromResponse, versionResponse } from './enterpriseCodocsVersions'

// Read-only version history of a department document (inventory A11, Q3 first
// version): list plus the exact version, for anyone who may read the
// department's documents. Runtime re-derives the department relation and
// serves the rows; the Host reads the named snapshot object. There is no
// restore, delete or diff-to-save flow. Registered with the department
// collaboration switch, the same as the Runtime routes.

type EnterpriseUser = Awaited<ReturnType<typeof requireEnterpriseUser>>
type Operation = Parameters<typeof prepareEnterpriseRuntime>[1]

const listOperation = 'codocs.department-documents-versions' as Operation
const viewOperation = 'codocs.department-documents-version-view' as Operation
const documentViewOperation = 'codocs.department-documents-view' as Operation

const departmentPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const versionPattern = /^[1-9][0-9]{0,15}$/

function bad(message: string) {
  return createError({ statusCode: 400, message, data: { code: 'department_versions_request_invalid' } })
}

function parse(event: H3Event, withVersion: boolean) {
  if (!codocsDepartmentCollaborationV2Enabled()) {
    throw createError({ statusCode: 404, message: '部门文档协作未启用', data: { code: 'department_collaboration_disabled' } })
  }
  const uuid = String(getRouterParam(event, 'uuid') || '')
  if (!uuidPattern.test(uuid)) throw bad('文档标识无效')
  const params = getRequestURL(event).searchParams
  const query = getQuery(event)
  if (Object.keys(query).some(key => key !== 'dept_code') || params.getAll('dept_code').length !== 1) throw bad('部门文档版本请求无效')
  const deptCode = query.dept_code
  if (typeof deptCode !== 'string' || !departmentPattern.test(deptCode)) throw bad('部门编码无效')
  let versionId = ''
  if (withVersion) {
    versionId = String(getRouterParam(event, 'versionId') || '')
    if (!versionPattern.test(versionId) || !Number.isSafeInteger(Number(versionId))) throw bad('版本标识无效')
  }
  return { uuid: uuid.toLowerCase(), deptCode, versionId }
}

// Token first, then the current person authorization, then the short permit.
async function permit(event: H3Event, user: EnterpriseUser, operation: Operation) {
  await prepareEnterpriseRuntime(event, operation)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'departments', 'view', snapshot.actionPolicies?.departments)) {
    throw createError({ statusCode: 403, message: '缺少部门文档查看权限' })
  }
  return { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'department-documents', action: 'read', expiresAt: enterpriseRuntimePermitExpiresAt() }
}

async function readRows(event: H3Event, user: EnterpriseUser, deptCode: string, uuid: string) {
  return rowsFromResponse(await callEnterpriseRuntime(event, listOperation, {
    tenant: user.tenant, deployment: user.deployment, code: deptCode, subId: uuid, authorization: await permit(event, user, listOperation)
  }))
}

export async function enterpriseCodocsDepartmentVersionsList(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const { uuid, deptCode } = parse(event, false)
  const user = await requireEnterpriseUser(event)
  return { success: true, data: (await readRows(event, user, deptCode, uuid)).map(versionResponse) }
}

export async function enterpriseCodocsDepartmentVersionView(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const { uuid, deptCode, versionId } = parse(event, true)
  const user = await requireEnterpriseUser(event)
  const response = await callEnterpriseRuntime(event, viewOperation, {
    tenant: user.tenant, deployment: user.deployment, code: deptCode, subId: uuid, objectId: versionId, authorization: await permit(event, user, viewOperation)
  }) as { success?: boolean, data?: Parameters<typeof versionResponse>[0] }
  const row = response?.data
  if (response?.success !== true || !row || String(row.id) !== versionId) throw createError({ statusCode: 503, message: '文档版本详情响应无效' })
  const version = versionResponse(row)
  if (!version.ossVersionId) throw createError({ statusCode: 400, message: '版本数据不完整，该版本可能是在开启 OSS 版本控制之前创建的' })
  // Only v1 rows (no object_key) live at the document path; v2 rows name their snapshot object.
  let ossPath = ''
  if (version.objectKey === null) {
    const metadata = await callEnterpriseRuntime(event, documentViewOperation, {
      tenant: user.tenant, deployment: user.deployment, code: deptCode, subId: uuid, authorization: await permit(event, user, documentViewOperation)
    }) as { success?: boolean, data?: { uuid?: string, oss_path?: string | null, doc_type?: string, dept_code?: string } }
    if (metadata?.success !== true || metadata.data?.uuid !== uuid || metadata.data.doc_type !== 'department' || metadata.data.dept_code !== deptCode || typeof metadata.data.oss_path !== 'string' || !metadata.data.oss_path) {
      throw createError({ statusCode: 503, message: '文档版本元数据响应无效' })
    }
    ossPath = metadata.data.oss_path
  }
  const content = await readVersionBody(event, version, ossPath, async () => Math.max(...(await readRows(event, user, deptCode, uuid)).map(item => Number(item.version_num ?? item.versionNum) || 0)))
  return { success: true, data: { content: content.toString('utf-8'), versionNum: version.versionNum, editorUid: version.editorUid, createdAt: version.createdAt } }
}
