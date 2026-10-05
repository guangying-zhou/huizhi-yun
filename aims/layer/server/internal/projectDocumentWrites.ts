import { isValidProjectAttachmentSize, PROJECT_DOCUMENT_MAX_ATTACHMENT_BYTES } from '../../../shared/projectDocumentRules'
import { owningCreateError as createError, type OwningH3Event as H3Event } from '@hzy/foundation/server/utils/owningModuleHttp'
import { createCodocsDocument, uploadCodocsProjectCabinetFile } from '../../../server/utils/codocsApi'
import { documentActor, hostDocumentOwner, hostDocumentWrite, hostProjectDocumentContext, type DocumentReadPermitProvider } from './projectDocumentPorts'

const text = (v: unknown) => String(v ?? '').trim()
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const allowedExtensions = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt', 'csv', 'zip', 'rar', '7z', 'tar', 'gz'])

export async function writeHostProjectDocument(event: H3Event, provider: DocumentReadPermitProvider, action: 'create-index' | 'create-markdown' | 'upload-file' | 'delete', keys: { projectId?: string, documentId?: string, documentUuid?: string }, payload: Record<string, unknown> = {}) {
  const user = await documentActor(event, 'edit')
  const uuid = keys.documentUuid || ''
  if (action !== 'delete' && !uuidPattern.test(uuid)) throw createError({ statusCode: 400, message: '文档标识无效' })
  // Resolve the final owner, including a milestone or inherited parent, before
  // any Codocs mutation. Never let the outer projectId override these facts.
  const ownerPayload = action === 'create-index'
    ? { ...payload, uuid }
    : {
        ...((payload.milestoneId ?? payload.milestone_id) ? { milestoneId: payload.milestoneId ?? payload.milestone_id } : { projectId: keys.projectId }),
        ...(payload.parentId ?? payload.parent_id ? { parentId: payload.parentId ?? payload.parent_id } : {})
      }
  const projectId = await hostDocumentOwner(event, ownerPayload, action === 'delete' ? keys.documentId : undefined)
  if (keys.projectId && keys.projectId !== projectId) throw createError({ statusCode: 403, message: '文档不属于当前项目' })
  const context = await hostProjectDocumentContext(event, provider, projectId, action === 'delete' ? keys.documentId : undefined)
  if (action === 'delete') {
    const doc = context.document!
    const folder = doc.isFolder === true || doc.is_folder === 1 || doc.isFolder === 1
    if (!context.isManager && (folder || text(doc.createdBy ?? doc.created_by) !== user.uid)) throw createError({ statusCode: 403, message: '仅项目经理或上传人可以删除项目文档' })
    // Delete only the project reference. Independent Codocs shares, content
    // and cabinet attachments have their own lifecycle and remain untouched.
    return await hostDocumentWrite(event, 'delete', context, {}, keys.documentId)
  }
  if (!context.isMember && !context.isScopedProjectAdmin) throw createError({ statusCode: 403, message: '仅项目成员可以创建项目文档' })
  const title = text(payload.title)
  if (action !== 'upload-file' && !title) throw createError({ statusCode: 400, message: '标题不能为空' })
  if (action === 'create-index') {
    let frozenPayload: Record<string, unknown> = { ...payload, uuid, title }
    const repoPath = text(payload.repoFilePath ?? payload.repo_file_path)
    if (text(payload.documentSource ?? payload.document_source ?? payload.source) === 'repo' && !repoPath.startsWith('codocs/projects/')) {
      const repoProjectCode = text(payload.repoProjectCode ?? payload.repo_project_code)
      await hostProjectDocumentContext(event, provider, projectId, undefined, repoProjectCode)
      const selectedCommit = text(payload.repoCommitId ?? payload.repo_commit_id)
      const { getGitRepositoryFile } = await import('@hzy/foundation/server/utils/gitIntegration')
      const file = await getGitRepositoryFile({ repoPath: repoProjectCode, path: repoPath, commitId: selectedCommit || undefined })
      if (file.path !== repoPath || !/^[A-Za-z0-9._-]{1,120}$/.test(file.commitId || '')) throw createError({ statusCode: 503, message: '仓库返回的提交版本无效' })
      if (selectedCommit && file.commitId !== selectedCommit) throw createError({ statusCode: 409, message: '仓库文档提交版本不一致' })
      frozenPayload = { ...frozenPayload, repoCommitId: file.commitId }
      // Remove a legacy alias so it cannot shadow the canonical frozen commit.
      delete (frozenPayload as Record<string, unknown>).repo_commit_id
    }
    const result = await hostDocumentWrite(event, 'create', context, frozenPayload) as { code: number, data: Record<string, unknown> }
    const folder = [true, 1, '1'].includes((payload.isFolder ?? payload.is_folder) as boolean | number | string)
    const backing = ['documentSource', 'document_source', 'codocsUuid', 'codocs_uuid', 'repoProjectCode', 'repo_project_code', 'repoFilePath', 'repo_file_path', 'ossPath', 'oss_path'].some(key => text(payload[key]))
    if (!folder && !backing) await createCodocsDocument({ event, uuid, title, ownerUid: user.uid, content: '', docType: 'project', projectCode: context.projectCode, folderPath: text(result.data.folderPath) || undefined })
    return result
  }
  if (action === 'create-markdown') {
    const name = text(payload.sourceFileName ?? payload.source_file_name)
    if (name && !/\.md$/i.test(name)) throw createError({ statusCode: 400, message: 'Markdown 文档仅支持 .md 文件' })
    const content = typeof payload.content === 'string' ? payload.content : ''
    if (new TextEncoder().encode(content).byteLength > PROJECT_DOCUMENT_MAX_ATTACHMENT_BYTES) throw createError({ statusCode: 400, message: '文档内容不得超过 100 MB' })
    await createCodocsDocument({ event, uuid, title, ownerUid: user.uid, content, docType: 'project', deptCode: context.deptCode || undefined, projectCode: context.projectCode, folderPath: text(payload.folderPath) || undefined })
    return await hostDocumentWrite(event, 'create', context, { ...ownerPayload, uuid, title, projectCode: context.projectCode, docCategory: text(payload.docCategory ?? payload.doc_category) || 'general', isFolder: false, codocsUuid: uuid, documentSource: 'codocs', contentSize: Buffer.byteLength(content, 'utf8') })
  }
  const encoded = text(payload.contentBase64)
  const data = Buffer.from(encoded, 'base64')
  const name = text(payload.fileName)
  const extension = name.split('.').pop()?.toLowerCase() || ''
  if (!name || !isValidProjectAttachmentSize(data.length) || data.toString('base64') !== encoded || !allowedExtensions.has(extension)) throw createError({ statusCode: 400, message: '文件内容或类型无效' })
  const uploaded = await uploadCodocsProjectCabinetFile({ event, ownerUid: user.uid, fileUuid: uuid, projectCode: context.projectCode, deptCode: context.deptCode, fileName: name, data, contentType: text(payload.contentType) || 'application/octet-stream' })
  if (uploaded.uuid !== uuid) throw createError({ statusCode: 503, message: '文件服务返回的文档标识不一致' })
  const category = text(payload.docCategory).startsWith('other_') ? text(payload.docCategory) : ['doc', 'docx'].includes(extension) ? 'other_word' : ['xls', 'xlsx'].includes(extension) ? 'other_excel' : ['ppt', 'pptx'].includes(extension) ? 'other_powerpoint' : extension === 'pdf' ? 'other_pdf' : 'other_file'
  return await hostDocumentWrite(event, 'create', context, { uuid: uploaded.uuid, projectId, projectCode: context.projectCode, title: uploaded.filename || name, docCategory: category, isFolder: false, documentSource: 'repo', repoProjectCode: context.projectCode, repoFilePath: uploaded.ossPath, ossPath: uploaded.ossPath, contentSize: uploaded.fileSize || data.length })
}
