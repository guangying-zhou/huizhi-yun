import { owningCreateError as createError, type OwningH3Event as H3Event } from '@hzy/foundation/server/utils/owningModuleHttp'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { searchDepartmentDocuments, searchProjectDocuments } from '../../../server/utils/codocsApi'
import { documentActor, documentEnvelope, hostProjectDocumentContext, type DocumentReadPermitProvider } from './projectDocumentPorts'

export function isValidHostGitRepositoryPath(value: string) {
  return value.length <= 255 && !value.includes('..') && /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(value)
}

type SourceAction = 'dept-documents' | 'project-documents' | 'repo-tree' | 'repo-doc'
export async function readHostProjectDocumentSource(event: H3Event, provider: DocumentReadPermitProvider, action: SourceAction, input: Record<string, string>) {
  const user = await documentActor(event, 'view')
  const { projectId = '', deptCode = '', repoProjectCode = '', path = '', ref = '', commitId = '', documentId = '' } = input
  const code = /^[A-Za-z0-9._-]{1,120}$/
  if (Object.keys(input).some(key => !['projectId', 'deptCode', 'repoProjectCode', 'path', 'ref', 'commitId', 'documentId'].includes(key)) || (ref && !/^[A-Za-z0-9._/-]{1,200}$/.test(ref)) || (commitId && !code.test(commitId))) throw createError({ statusCode: 400, message: '项目文档来源参数无效' })
  if (action === 'dept-documents') {
    if (!code.test(deptCode || '') || projectId || repoProjectCode || path || ref || commitId || documentId) throw createError({ statusCode: 400, message: '部门文档来源参数无效' })
    const checked = documentEnvelope(await callEnterpriseRuntime<{ code: number, data: { deptCode: string } }>(event, 'aims.project-document-department-source', {
      tenant: user.tenant, deployment: user.deployment, deptCode,
      authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'projects', action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt() }
    }))
    if (checked.deptCode !== deptCode) throw createError({ statusCode: 503, message: '部门文档授权响应无效' })
    const res = await searchDepartmentDocuments({ event, deptCode, actorUid: user.uid })
    return { code: 0, data: {
      folders: (res.data?.folders || []).map(folder => ({ id: folder.id, name: folder.name, parentId: folder.parent_id, updatedAt: folder.updated_at })),
      items: (res.data?.items || []).map(item => ({ uuid: item.uuid, title: item.title, ownerUid: item.ownerUid, deptCode: item.deptCode, folderId: item.folderId ?? null, folderName: item.folderName ?? null, aiAbstract: item.aiAbstract, updatedAt: item.updatedAt, contentSize: item.contentSize }))
    } }
  }
  if (!/^[1-9]\d*$/.test(projectId || '') || !Number.isSafeInteger(Number(projectId)) || deptCode) throw createError({ statusCode: 400, message: '项目文档来源参数无效' })
  if (action === 'project-documents') {
    if (repoProjectCode || path || ref || commitId || documentId) throw createError({ statusCode: 400, message: '项目文档来源参数无效' })
    const context = await hostProjectDocumentContext(event, provider, projectId)
    const gitGroup = typeof (context as unknown as Record<string, unknown>).gitGroup === 'string' ? String((context as unknown as Record<string, unknown>).gitGroup) : null
    if (!gitGroup) return { code: 0, data: { folders: [], items: [], gitGroup: null } }
    const res = await searchProjectDocuments({ event, projectCode: gitGroup, actorUid: user.uid })
    return { code: 0, data: { gitGroup, folders: (res.data?.folders || []).map(folder => ({ id: folder.id, name: folder.name, parentId: folder.parent_id, updatedAt: folder.updated_at })), items: res.data?.items || [] } }
  }
  if (!isValidHostGitRepositoryPath(repoProjectCode) || (action === 'repo-tree' && path) || (action === 'repo-doc' && (!path || path.length > 400)) || (documentId && !/^[1-9]\d*$/.test(documentId)) || !['repo-tree', 'repo-doc'].includes(action)) throw createError({ statusCode: 400, message: '仓库文档来源参数无效' })
  type GitFile = { path: string, name: string, size: number, encoding: string, content: string, ref: string, commitId: string, lastCommitId: string, blobId: string }
  const result = await hostProjectDocumentContext<{ file: GitFile, latest: Pick<GitFile, 'path' | 'commitId' | 'lastCommitId' | 'blobId'> }>(event, provider, projectId, documentId || undefined, repoProjectCode, undefined, undefined, { operation: action === 'repo-tree' ? 'markdown-tree' : 'file', ...(path ? { path } : {}), ...(ref ? { ref } : {}), ...(commitId ? { commitId } : {}) })
  if (action === 'repo-tree') return { code: 0, message: 'success', data: result }
  const file = result.file
  // The file at the fixed commit supplies preview bytes. Read current metadata
  // separately; lastCommitId on a historical response is not the latest version.
  if (file.path !== path || !code.test(file.commitId || '') || !file.blobId) throw createError({ statusCode: 503, message: '仓库文档版本响应无效' })
  const latest = result.latest
  if (latest.path !== path || !code.test(latest.commitId || '') || !latest.blobId) throw createError({ statusCode: 503, message: '仓库文档最新版本响应无效' })
  return { code: 0, message: 'success', data: {
    path: file.path, name: file.name, size: file.size, encoding: file.encoding, content: file.content, ref: file.ref,
    commit_id: file.commitId, last_commit_id: file.lastCommitId, blob_id: file.blobId,
    latest_commit_id: latest.lastCommitId || latest.commitId,
    has_new_version: Boolean(commitId && file.blobId && latest.blobId && file.blobId !== latest.blobId)
  } }
}
