/**
 * 创建文档发布申请
 * POST /api/reviews/publish-requests
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime, getCodocsDocumentMetadata, updateCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'
import { fetchDirectoryData } from '~~/server/utils/directoryCompat'
import { downloadDocument, uploadDocument } from '~~/server/utils/oss'
import { requirePermission } from '~~/server/utils/checkPermission'

interface SubmitPublishRequestBody {
  document_uuid?: string
  review_type?: string
  sub_type?: string | null
  committee_mode?: 'assist' | 'vote' | string
  committee_pass_count?: number
  committee_vote_type?: 'majority' | 'supermajority' | string
  extra?: unknown
}

interface RuntimePage<T> {
  items?: T[]
}

interface PublishRequestRow {
  id: number
  workflow_status?: string
  workflow_instance_id?: number | string | null
}

interface DepartmentRecord {
  deptCode: string
  name?: string
  orgType?: string
  deptCategory?: number | null
  managerId?: string | null
  leaderId?: string | null
  parentId?: string | null
}

type OutsideFileLevel = 'general' | 'important' | 'critical'

interface OutsideReviewExtra {
  sendTo?: string
  sendReason?: string
  needsOfficialSeal?: boolean
  outsideFileLevel?: OutsideFileLevel
  businessDeptCode?: string | null
  businessDeptName?: string | null
  committeeDeptCode?: string | null
  committeeDeptName?: string | null
  sourceDeptCode?: string | null
  sourceDeptName?: string | null
  upperLeaderId?: string | null
}

const asObject = (value: unknown): Record<string, unknown> => {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

const buildSafeReviewPath = (requestId: number, title: string) => {
  const sanitizedTitle = title
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 100)
  return `codocs/reviews/${requestId}_${sanitizedTitle || 'untitled'}.md`
}

const resolveTargetCategory = (reviewType: string, subType?: string | null) => {
  if (reviewType === '对外发文' || reviewType === '部门发文') return 'department'
  if (subType === '产品资料') return 'product'
  if (subType === '公司知识库') return 'knowledge'
  if (subType === '文档模板') return 'template'
  return 'company'
}

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  await requirePermission(event, 'reviews', 'submit', '缺少审阅提交权限')
  const body = await readBody<SubmitPublishRequestBody>(event)
  const {
    document_uuid,
    review_type,
    sub_type,
    committee_mode,
    committee_pass_count,
    committee_vote_type,
    extra
  } = body

  if (!document_uuid || !review_type) {
    throw createError({ statusCode: 400, message: '缺少必填参数' })
  }

  const document = await getCodocsDocumentMetadata(event, document_uuid, { actorUid: uid })
  if (!document?.id || !document.uuid) {
    throw createError({ statusCode: 404, message: '文档不存在' })
  }

  const existingPage = await callCodocsTenantRuntime<RuntimePage<PublishRequestRow>>(event, '/v1/codocs/reviews/publish-requests', {
    query: {
      document_uuid,
      limit: 100
    },
    scope: 'codocs.read'
  })
  const existing = (existingPage.items || []).find(item => ['draft', 'running'].includes(String(item.workflow_status || '')))
  if (existing?.workflow_status === 'draft' && !existing.workflow_instance_id) {
    await callCodocsTenantRuntime(event, `/v1/codocs/reviews/publish-requests/${encodeURIComponent(String(existing.id))}`, {
      method: 'PATCH',
      scope: 'codocs.write',
      body: {
        workflow_status: 'cancelled',
        current_user: uid
      }
    })
  } else if (existing) {
    throw createError({ statusCode: 409, message: '该文档已有进行中的发布申请，请等待完成后再提交' })
  }

  let allDepartments: DepartmentRecord[] = []
  try {
    const departments = await fetchDirectoryData<{ flat?: DepartmentRecord[] }>('/departments', { event })
    allDepartments = departments.flat || []
  } catch (error) {
    console.warn('[PublishRequest] Failed to fetch departments list:', error)
  }

  const docDept = document.dept_code
    ? allDepartments.find(dept => dept.deptCode === document.dept_code) || null
    : null

  const baseExtra = {
    ...asObject(extra),
    committeeMode: committee_mode || null,
    committeePassCount: committee_pass_count || null,
    committeeVoteType: committee_vote_type || null
  }
  let resolvedExtra: Record<string, unknown> | null = baseExtra
  const inputExtra = asObject(extra) as OutsideReviewExtra

  if (review_type === '对外发文') {
    const fileLevel = inputExtra.outsideFileLevel || 'general'
    if (!inputExtra.sendTo?.trim() || !inputExtra.sendReason?.trim()) {
      throw createError({ statusCode: 400, message: '请填写收文对象和发文事由' })
    }
    if (inputExtra.needsOfficialSeal && fileLevel === 'general') {
      throw createError({ statusCode: 400, message: '加盖公章的对外发文，文件级别至少应为重要文件' })
    }

    const parentDept = docDept?.parentId
      ? allDepartments.find(dept => dept.deptCode === docDept.parentId) || null
      : null
    resolvedExtra = {
      ...baseExtra,
      sendTo: inputExtra.sendTo.trim(),
      sendReason: inputExtra.sendReason.trim(),
      needsOfficialSeal: Boolean(inputExtra.needsOfficialSeal),
      outsideFileLevel: fileLevel,
      sourceDeptCode: docDept?.deptCode || document.dept_code || null,
      sourceDeptName: docDept?.name || null,
      upperLeaderId: parentDept?.leaderId || parentDept?.managerId || null
    }
  }

  const resolvedTargetCategory = resolveTargetCategory(review_type, sub_type)

  const request = await callCodocsTenantRuntime<PublishRequestRow>(event, '/v1/codocs/reviews/publish-requests', {
    method: 'POST',
    scope: 'codocs.write',
    body: {
      document_id: document.id,
      document_uuid: document.uuid,
      review_type,
      sub_type: sub_type || null,
      initiator_uid: uid,
      target_category: resolvedTargetCategory,
      extra: resolvedExtra,
      workflow_status: 'draft',
      current_user: uid
    }
  })
  const requestId = Number(request.id)
  if (!Number.isInteger(requestId) || requestId <= 0) {
    throw createError({ statusCode: 500, message: '创建发布申请失败' })
  }

  const reviewOssPath = buildSafeReviewPath(requestId, document.title || 'untitled')
  try {
    if (document.oss_path) {
      const content = await downloadDocument(document.oss_path, document.doc_type)
      if (content) {
        await uploadDocument(reviewOssPath, content)
        await callCodocsTenantRuntime(event, `/v1/codocs/reviews/publish-requests/${encodeURIComponent(String(requestId))}`, {
          method: 'PATCH',
          scope: 'codocs.write',
          body: {
            review_oss_path: reviewOssPath,
            current_user: uid
          }
        })
      }
    }
  } catch (error) {
    console.warn('[PublishRequest] Failed to copy document snapshot:', error)
  }

  await updateCodocsDocumentMetadata(event, document.uuid, {
    readonly_flag: true,
    actorUid: uid,
    current_user: uid
  })

  return {
    code: 0,
    message: 'success',
    data: {
      publish_request: {
        id: requestId,
        document_uuid: document.uuid,
        workflow_status: 'draft'
      }
    }
  }
})
