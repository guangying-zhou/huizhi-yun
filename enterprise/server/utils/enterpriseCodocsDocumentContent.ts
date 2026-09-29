import { createError, type H3Event } from 'h3'
import { downloadDocument } from '../../../codocs/server/utils/oss'
import { hasMeaningfulMarkdownContent, recoverMarkdownFromYjsSnapshot } from '../../../codocs/server/utils/yjsMarkdownRecovery'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'

// Body of a document that has not moved to a published snapshot: its own
// Markdown, or the CRDT sidecar when the Markdown is empty. Storage failures
// surface as a fixed 503 without transport detail.
export async function readLegacyMarkdown(event: H3Event, path: string, type: string) {
  try {
    const source = await downloadDocument(path, type, { event })
    let content = source || ''
    if (!hasMeaningfulMarkdownContent(content)) content = await recoverMarkdownFromYjsSnapshot(path, type, { event })
    if (source === null && !hasMeaningfulMarkdownContent(content)) throw createError({ statusCode: 404, message: '文档正文不存在' })
    return content
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 404) throw error
    throw createError({ statusCode: 503, message: '文档存储暂不可用', data: { code: 'enterprise_document_storage_unavailable' } })
  }
}

type ContentOptions = {
  // The document comes from a Runtime view whose authorization is not a
  // department relation (open department documents). Runtime annotates
  // `snapshot_generation` (0 = still v1); a converted document's published
  // head can only come from the body reference in that response.
  bodyRef?: 'required'
}

const departmentPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

// Where an exact published head comes from, or null when the document reads
// from its own path. Runtime's body reference (view/download response) is the
// single authorization point; otherwise the Host asks the owning domain.
async function publishedHead(event: H3Event, doc: Record<string, unknown>, uuid: string, type: string, permission: 'view' | 'export', options: ContentOptions) {
  const reference = doc.body_ref ?? doc.snapshot_ref
  if (reference !== undefined && reference !== null) {
    const { parseSnapshotHead } = await import('./enterpriseCodocsSnapshot')
    return parseSnapshotHead(reference)
  }
  if (type === 'private' && process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 === 'true') {
    // Loaded only when v2 is switched on.
    const { readSnapshotHead } = await import('./enterpriseCodocsSnapshot')
    return await readSnapshotHead(event, await requireEnterpriseUser(event), uuid)
  }
  if (type === 'department') {
    const { codocsDepartmentCollaborationV2Enabled, readDepartmentSnapshotHead } = await import('./enterpriseCodocsDepartmentCollaboration')
    if (!codocsDepartmentCollaborationV2Enabled()) return null
    // Once department collaboration exists, a legacy path may be a stale
    // mirror. Never guess: a reader outside the department needs Runtime's
    // reference for a converted document, and an unannotated one fails closed.
    if (options.bodyRef === 'required') {
      if (doc.snapshot_generation === 0) return null
      throw createError({ statusCode: 503, message: '文档正文引用不可用，请稍后重试', data: { code: 'enterprise_document_body_ref_required' } })
    }
    if (typeof doc.dept_code !== 'string' || !departmentPattern.test(doc.dept_code)) {
      throw createError({ statusCode: 503, message: '文档元数据响应无效' })
    }
    return await readDepartmentSnapshotHead(event, await requireEnterpriseUser(event), doc.dept_code, uuid, permission)
  }
  return null
}

// Called only with metadata obtained from the actor-bound Runtime read. Never
// accept an OSS key or document type directly from the browser.
export async function withEnterpriseCodocsDocumentContent(event: H3Event, response: unknown, uuid: string, skipContent: boolean, permission: 'view' | 'export' = 'view', options: ContentOptions = {}) {
  const envelope = response as { success?: boolean, data?: Record<string, unknown> }
  const doc = envelope?.data
  if (envelope?.success !== true || !doc || doc.uuid !== uuid) throw createError({ statusCode: 503, message: '文档元数据响应无效' })
  const path = typeof doc.oss_path === 'string' ? doc.oss_path : ''
  const type = typeof doc.doc_type === 'string' ? doc.doc_type : ''
  let content = ''
  let snapshotBase: { snapshot_generation: number, snapshot_epoch: number } | null = null
  // A published v2 snapshot is authoritative; oss_path is only its derived
  // copy and is never repaired from a read (a reader must not write storage).
  if (!skipContent) {
    const head = await publishedHead(event, doc, uuid, type, permission, options)
    if (head) {
      snapshotBase = { snapshot_generation: head.generation, snapshot_epoch: head.epoch }
      if (head.generation > 0) {
        const { readSnapshotMarkdown } = await import('./enterpriseCodocsSnapshot')
        const markdown = await readSnapshotMarkdown(event, head)
        return { success: true, data: { ...doc, readonly_flag: doc.readonly ? 1 : doc.readonly_flag, content: markdown, ...snapshotBase } }
      }
    }
  }
  if (!skipContent && path) {
    content = await readLegacyMarkdown(event, path, type)
    if (path.startsWith('codocs/company/')) {
      try {
        const { recordEnterpriseCodocsDocumentAccess } = await import('./enterpriseCodocsDocumentAccessRecord')
        await recordEnterpriseCodocsDocumentAccess(event, uuid, path, permission)
      } catch (error) {
        // Never release the loaded bytes if auditing or its fresh ACL check fails.
        const status = (error as { statusCode?: number })?.statusCode
        if (status === 401 || status === 403 || status === 409) {
          throw createError({ statusCode: status, message: status === 409 ? '文档存储已变更，请重新读取' : '文档访问授权已失效' })
        }
        throw createError({ statusCode: 503, message: '文档访问记录暂不可用', data: { code: 'enterprise_document_access_record_unavailable' } })
      }
    }
  }
  return { success: true, data: { ...doc, readonly_flag: doc.readonly ? 1 : doc.readonly_flag, content,
    ...(snapshotBase || {}) } }
}
