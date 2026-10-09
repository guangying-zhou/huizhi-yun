import { createError, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { withEnterpriseCodocsDocumentContent } from './enterpriseCodocsDocumentContent'

type Folder = { id: number, name: string, parent_id?: number | null, dept_code: string, is_open?: number | boolean, sort_order?: number, children: Folder[], documents: Document[] }
type Document = { uuid: string, title: string, folder_id: number | null, dept_code?: string, doc_type: string, oss_path?: string, updated_at?: string }
type RuntimeData = { folders?: Folder[], documents?: Document[] }

async function openDepartmentRuntime(event: H3Event, code?: string) {
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'company', 'view', snapshot.actionPolicies?.company)) {
    throw createError({ statusCode: 403, message: '缺少部门开放文档查看权限' })
  }
  const operation = code ? 'codocs.open-department-documents-view' : 'codocs.open-department-documents-list'
  await prepareEnterpriseRuntime(event, operation)
  const response = await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment, ...(code ? { code } : {}),
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'open-department-documents', action: 'read', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }) as { success?: boolean, data?: RuntimeData }
  if (response?.success !== true || !Array.isArray(response.data?.folders) || !Array.isArray(response.data?.documents)) {
    throw createError({ statusCode: 503, message: '部门开放文档响应无效' })
  }
  return response.data
}

export async function listEnterpriseOpenDepartmentDocs(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const data = await openDepartmentRuntime(event)
  const folders = data.folders || []
  const documents = data.documents || []
  const byId = new Map<number, Folder>()
  const groups = new Map<string, { deptCode: string, deptName: string, documentCount: number, folders: Folder[] }>()
  for (const source of folders) {
    const id = Number(source.id)
    if (!Number.isSafeInteger(id) || id <= 0 || typeof source.dept_code !== 'string' || !source.dept_code) throw createError({ statusCode: 503, message: '开放目录响应无效' })
    byId.set(id, { ...source, id, children: [], documents: [] })
  }
  for (const doc of documents) {
    const folder = byId.get(Number(doc.folder_id))
    if (!folder || folder.dept_code !== doc.dept_code || doc.doc_type !== 'department' || typeof doc.uuid !== 'string') {
      throw createError({ statusCode: 503, message: '开放文档范围响应无效' })
    }
    folder.documents.push(doc)
    const group = groups.get(folder.dept_code) || { deptCode: folder.dept_code, deptName: folder.dept_code, documentCount: 0, folders: [] }
    group.documentCount++
    groups.set(folder.dept_code, group)
  }
  for (const folder of byId.values()) {
    const parent = byId.get(Number(folder.parent_id))
    if (parent && parent.dept_code === folder.dept_code) parent.children.push(folder)
    else {
      const group = groups.get(folder.dept_code) || { deptCode: folder.dept_code, deptName: folder.dept_code, documentCount: 0, folders: [] }
      group.folders.push(folder)
      groups.set(folder.dept_code, group)
    }
  }
  const sort = (items: Folder[]) => {
    items.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    for (const item of items) sort(item.children)
  }
  for (const group of groups.values()) sort(group.folders)
  return { success: true, data: { departments: [...groups.values()].sort((a, b) => a.deptCode.localeCompare(b.deptCode)) } }
}

export async function viewEnterpriseOpenDepartmentDoc(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const uuid = getRouterParam(event, 'uuid') || ''
  if (!/^[a-fA-F0-9-]{36}$/.test(uuid)) throw createError({ statusCode: 400, message: '文档标识无效' })
  const data = await openDepartmentRuntime(event, uuid)
  const doc = data.documents?.find(item => item.uuid === uuid)
  if (!doc) throw createError({ statusCode: 403, message: '该文档不在开放目录内' })
  const folder = data.folders?.find(item => Number(item.id) === Number(doc.folder_id))
  if (!folder || folder.dept_code !== doc.dept_code || doc.doc_type !== 'department') throw createError({ statusCode: 403, message: '该文档不在开放目录内' })
  // Readers outside the department cannot ask its snapshot: the Runtime view must carry the body reference.
  const response = await withEnterpriseCodocsDocumentContent(event, { success: true, data: doc }, uuid, false, 'view', { bodyRef: 'required' })
  return { ...response, data: { ...response.data, readonly_flag: 1, readonly: true } }
}
