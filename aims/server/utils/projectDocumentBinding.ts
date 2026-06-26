/**
 * 解析 AimsDocumentPicker 返回的统一文档引用 payload
 * 并转换为 project_documents 行所需的字段
 */
import type { H3Event } from 'h3'
import type { RowDataPacket } from '~~/server/utils/db'
import { getCodocsDocumentSummary } from '~~/server/utils/codocsApi'
import { queryRow } from '~~/server/utils/db'

export type DocumentSource = 'codocs' | 'repo'

export interface DocumentBindingPayload {
  source?: DocumentSource
  // codocs
  codocsUuid?: string | null
  // repo
  repoProjectCode?: string | null
  repoFilePath?: string | null
  repoCommitId?: string | null
  // 冗余标题（前端可以直接传，后端 codocs 兜底查）
  title?: string | null
}

export interface ResolvedBinding {
  source: DocumentSource
  title: string
  contentSize: number
  // codocs
  codocsUuid: string | null
  // repo
  repoProjectCode: string | null
  repoFilePath: string | null
  repoCommitId: string | null
  /** 用于 query 是否重复绑定：codocs → codocs_uuid; repo → repo_project_code+file_path */
  dedupKey: { codocsUuid?: string, repoProjectCode?: string, repoFilePath?: string }
}

/**
 * 根据 payload 解析出统一绑定信息
 * 对 codocs 源：查 codocs 文档元信息；对 repo 源：查 Account git_projects 校验存在
 */
export async function resolveDocumentBinding(payload: DocumentBindingPayload, event?: H3Event): Promise<ResolvedBinding> {
  const source: DocumentSource = payload.source === 'repo' ? 'repo' : 'codocs'

  if (source === 'codocs') {
    const uuid = (payload.codocsUuid || '').trim()
    if (!uuid) {
      throw createError({ statusCode: 400, message: 'codocs 源需要 codocsUuid' })
    }
    const summary = await getCodocsDocumentSummary(uuid, event)
    return {
      source: 'codocs',
      title: payload.title?.trim() || summary.data.title,
      contentSize: summary.data.contentSize || 0,
      codocsUuid: uuid,
      repoProjectCode: null,
      repoFilePath: null,
      repoCommitId: null,
      dedupKey: { codocsUuid: uuid }
    }
  }

  // repo
  const repoCode = (payload.repoProjectCode || '').trim()
  const filePath = (payload.repoFilePath || '').trim()
  if (!repoCode || !filePath) {
    throw createError({ statusCode: 400, message: 'repo 源需要 repoProjectCode 和 repoFilePath' })
  }
  return {
    source: 'repo',
    title: payload.title?.trim() || filePath.split('/').pop() || filePath,
    contentSize: 0,
    codocsUuid: null,
    repoProjectCode: repoCode,
    repoFilePath: filePath,
    repoCommitId: payload.repoCommitId?.trim() || null,
    dedupKey: { repoProjectCode: repoCode, repoFilePath: filePath }
  }
}

export interface ExistingDocRow extends RowDataPacket {
  id: number
}

/** 查该项目下是否已有指向同一文档的绑定（按 source + dedupKey） */
export async function findDuplicateProjectDoc(
  projectId: number,
  binding: ResolvedBinding,
  extraWhere = ''
): Promise<number | null> {
  if (binding.source === 'codocs') {
    const row = await queryRow<ExistingDocRow>(
      `SELECT id FROM project_documents
       WHERE project_id = ?
         AND work_item_id IS NULL
         AND is_folder = 0
         AND document_source = 'codocs'
         AND (codocs_uuid = ? OR uuid = ?)
         ${extraWhere}
       LIMIT 1`,
      [projectId, binding.codocsUuid, binding.codocsUuid]
    )
    return row?.id ?? null
  }
  const row = await queryRow<ExistingDocRow>(
    `SELECT id FROM project_documents
     WHERE project_id = ?
       AND work_item_id IS NULL
       AND is_folder = 0
       AND document_source = 'repo'
       AND repo_project_code = ?
       AND repo_file_path = ?
       ${extraWhere}
     LIMIT 1`,
    [projectId, binding.repoProjectCode, binding.repoFilePath]
  )
  return row?.id ?? null
}
