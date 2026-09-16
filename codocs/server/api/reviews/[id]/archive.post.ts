/**
 * Workflow 发文审批通过后确认发布。
 *
 * runtime 负责生成不可篡改的归档计划和事务落库；Codocs BFF 只在两步之间
 * 完成 OSS 内容复制，并在事务成功后编排通知与临时快照清理。
 */
import { deleteDocument, downloadDocument, uploadDocument } from '../../../utils/oss'
import { notifyPublished, notifySealAdminsNeeded } from '../../../utils/reviewNotify'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface PublishArchivePlan {
  publishRequestId: number
  alreadyArchived: boolean
  sourceOssPath: string
  sourceDocumentType: string
  reviewSnapshotOssPath?: string | null
  archiveOssPath: string
  publishedDocumentUuid: string
  documentTitle: string
  archiveKey: string
  publishScope: 'department' | 'company'
  departmentCode?: string | null
  needsOfficialSeal: boolean
  executionStatus?: string | null
  idempotent?: boolean
}

const requirePublishRequestId = (event: Parameters<typeof getRouterParam>[0]) => {
  const id = String(getRouterParam(event, 'id') || '').trim()
  if (!/^\d+$/.test(id)) {
    throw createError({ statusCode: 400, message: '发布申请 ID 无效' })
  }
  return id
}

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  await requirePermission(event, 'reviews', 'archive', '缺少发文归档权限')
  const requestId = requirePublishRequestId(event)

  const plan = await callCodocsTenantRuntime<PublishArchivePlan>(
    event,
    `/v1/codocs/reviews/publish-requests/${encodeURIComponent(requestId)}/archive-plan`,
    {
      method: 'POST',
      scope: 'codocs.write',
      body: { current_user: uid }
    }
  )

  if (plan.alreadyArchived) {
    return {
      code: 0,
      message: 'success',
      data: {
        new_document_uuid: plan.publishedDocumentUuid,
        archive_oss_path: plan.archiveOssPath,
        execution_status: plan.executionStatus || null,
        already_archived: true
      }
    }
  }

  const content = await downloadDocument(plan.sourceOssPath, plan.sourceDocumentType)
  if (!content) {
    throw createError({ statusCode: 404, message: '待发布文档内容不存在' })
  }
  await uploadDocument(plan.archiveOssPath, content)

  const committed = await callCodocsTenantRuntime<PublishArchivePlan>(
    event,
    `/v1/codocs/reviews/publish-requests/${encodeURIComponent(requestId)}/archive`,
    {
      method: 'POST',
      scope: 'codocs.write',
      body: {
        current_user: uid,
        archiveOssPath: plan.archiveOssPath,
        publishedDocumentUuid: plan.publishedDocumentUuid
      }
    }
  )

  if (plan.reviewSnapshotOssPath) {
    try {
      await deleteDocument(plan.reviewSnapshotOssPath)
    } catch (error) {
      console.warn('[ReviewArchive] Failed to clean review snapshot:', error)
    }
  }

  await notifyPublished(
    plan.publishScope,
    plan.documentTitle,
    plan.archiveKey,
    plan.publishedDocumentUuid,
    plan.publishScope === 'department' ? plan.departmentCode : null,
    { event, archiveOssPath: plan.archiveOssPath }
  )
  if (plan.archiveKey === '对外发文' && plan.needsOfficialSeal) {
    await notifySealAdminsNeeded(plan.documentTitle, Number(requestId))
  }

  return {
    code: 0,
    message: 'success',
    data: {
      new_document_uuid: committed.publishedDocumentUuid,
      archive_oss_path: committed.archiveOssPath,
      execution_status: committed.executionStatus || null,
      already_archived: Boolean(committed.idempotent)
    }
  }
})
