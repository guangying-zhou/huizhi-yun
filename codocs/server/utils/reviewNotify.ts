/**
 * 审阅通知工具 — 基于通用通知封装的审阅场景快捷方法
 */
import type { H3Event } from 'h3'
import { resolveCurrentAppUrl } from '@hzy/foundation/server/utils/appUrls'
import { publishedAssetPagePath } from '~~/shared/utils/publishedAssetLink'
import { getRoleMemberUids } from './accountPermissions'
import { fetchDirectoryData } from './directoryCompat'
import {
  buildCodocsNotification,
  codocsNotificationIdempotencyKey,
  type CodocsNotificationInput
} from './codocsNotificationBuilders'
import type { AccountUsersData } from '~/types/account'

interface DepartmentMember {
  uid?: string
}

interface ReviewNotifyContext {
  reviewType?: string | null
  archiveKey?: string | null
  eventVersion?: string | number | null
}

const isOutsideReviewContext = (context?: ReviewNotifyContext) => {
  return context?.reviewType === '对外发文' || context?.archiveKey === '对外发文'
}

const getReviewTargetLabel = (docTitle: string, context?: ReviewNotifyContext) => {
  return `${isOutsideReviewContext(context) ? '对外发文' : '文档'}《${docTitle}》`
}

function getNotifyBaseUrl() {
  const config = useRuntimeConfig()
  return config.public.siteUrl || 'https://codocs.wiztek.cn'
}

async function getDepartmentMemberUids(deptCode: string, event?: H3Event) {
  const response = await fetchDirectoryData<{ items?: DepartmentMember[] }>(`/departments/${encodeURIComponent(deptCode)}/members`, {
    timeout: 10000,
    event
  })

  if (!Array.isArray(response.items)) {
    return []
  }

  return response.items
    .map(member => member.uid)
    .filter((uid): uid is string => Boolean(uid))
}

async function getCompanyMemberUids(event?: H3Event) {
  const response = await fetchDirectoryData<AccountUsersData>('/users', {
    timeout: 10000,
    event
  })

  if (!response.items) {
    return []
  }

  return response.items
    .map(user => user.uid)
    .filter((uid): uid is string => Boolean(uid))
}

async function deliverReviewNotification(input: CodocsNotificationInput): Promise<boolean> {
  try {
    await sendNotification(buildCodocsNotification(input))
    return true
  } catch (error) {
    console.warn('[ReviewNotify] Notification delivery failed:', error)
    return false
  }
}

/** @deprecated 使用带稳定业务身份的审阅通知 helper。 */
export const sendReviewNotification = deliverReviewNotification

/**
 * 通知审阅人 - 新审阅提交或流程推进
 */
export async function notifyReviewers(
  reviewers: string[],
  docTitle: string,
  reviewId: number,
  nodeName: string,
  context?: ReviewNotifyContext
) {
  const baseUrl = getNotifyBaseUrl()
  const isOutsideReview = isOutsideReviewContext(context)
  const targetLabel = getReviewTargetLabel(docTitle, context)

  await deliverReviewNotification({
    touser: reviewers,
    title: isOutsideReview ? '对外发文审批通知' : '文档审阅通知',
    description: `您有一份${targetLabel}${isOutsideReview ? '待审批' : '待审阅'}，当前环节：${nodeName}`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: isOutsideReview ? '立即审批' : '立即审阅',
    eventType: 'codocs.review.pending',
    category: 'document_review',
    severity: 'warning',
    bizType: 'document_review',
    bizId: reviewId,
    idempotencyKey: codocsNotificationIdempotencyKey(
      'review-pending',
      reviewId,
      context?.eventVersion || nodeName
    ),
    metadata: {
      notificationKind: 'business_event',
      reviewId,
      reviewType: context?.reviewType || null,
      archiveKey: context?.archiveKey || null,
      nodeName,
      eventVersion: context?.eventVersion || null
    }
  })
}

/**
 * 通知发起人 - 审批通过
 */
export async function notifyApproved(
  initiatorUid: string,
  docTitle: string,
  reviewId: number,
  context?: ReviewNotifyContext
) {
  const baseUrl = getNotifyBaseUrl()
  const isOutsideReview = isOutsideReviewContext(context)
  const targetLabel = getReviewTargetLabel(docTitle, context)

  await deliverReviewNotification({
    touser: initiatorUid,
    title: isOutsideReview ? '对外发文审批通过' : '文档审批通过',
    description: `您提交的${targetLabel}已${isOutsideReview ? '完成审批' : '通过全部审批'}，请确认发布`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '确认发布',
    eventType: 'codocs.review.approved',
    category: 'document_review',
    severity: 'success',
    bizType: 'document_review',
    bizId: reviewId,
    idempotencyKey: codocsNotificationIdempotencyKey('review-approved', reviewId, context?.eventVersion || 'approved'),
    metadata: {
      notificationKind: 'business_event',
      reviewId,
      reviewType: context?.reviewType || null,
      archiveKey: context?.archiveKey || null,
      initiatorUid,
      eventVersion: context?.eventVersion || null
    }
  })
}

/**
 * 通知上级领导 - 一般文件对外发文审批完成
 */
export async function notifyOutsideGeneralLeader(
  leaderUid: string,
  docTitle: string,
  reviewId: number
) {
  const baseUrl = getNotifyBaseUrl()

  await deliverReviewNotification({
    touser: leaderUid,
    title: '对外发文审批完成通知',
    description: `对外发文《${docTitle}》已完成一般文件审批，请知悉。`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '查看详情',
    eventType: 'codocs.review.outside_general_completed',
    category: 'document_review',
    severity: 'success',
    bizType: 'document_review',
    bizId: reviewId,
    idempotencyKey: codocsNotificationIdempotencyKey('review-outside-general-completed', reviewId),
    metadata: {
      notificationKind: 'business_event',
      reviewId,
      leaderUid,
      reviewType: '对外发文'
    }
  })
}

/**
 * 通知公章管理员 - 对外发文发布后需办理盖章
 */
export async function notifySealAdminsNeeded(
  docTitle: string,
  reviewId: number
) {
  const baseUrl = getNotifyBaseUrl()
  const recipients = await getRoleMemberUids('seal_admin')

  if (recipients.length === 0) {
    console.warn('[ReviewNotify] Skip seal notification: no seal_admin members found')
    return
  }

  await deliverReviewNotification({
    touser: recipients,
    title: '对外发文用章提醒',
    description: `对外发文《${docTitle}》已确认发布，待公章管理员办理盖章。`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '查看详情',
    eventType: 'codocs.review.seal_required',
    category: 'document_review',
    severity: 'warning',
    bizType: 'document_review',
    bizId: reviewId,
    idempotencyKey: codocsNotificationIdempotencyKey('review-seal-required', reviewId),
    metadata: {
      notificationKind: 'business_event',
      reviewId,
      reviewType: '对外发文',
      recipientRole: 'seal_admin'
    }
  })
}

export async function notifySealConfirmed(
  initiatorUid: string,
  docTitle: string,
  reviewId: number
) {
  const baseUrl = getNotifyBaseUrl()

  await deliverReviewNotification({
    touser: initiatorUid,
    title: '对外发文盖章完成',
    description: `对外发文《${docTitle}》已完成盖章，请继续确认发送。`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '查看详情',
    eventType: 'codocs.review.seal_confirmed',
    category: 'document_review',
    severity: 'success',
    bizType: 'document_review',
    bizId: reviewId,
    idempotencyKey: codocsNotificationIdempotencyKey('review-seal-confirmed', reviewId),
    metadata: {
      notificationKind: 'business_event',
      reviewId,
      initiatorUid,
      reviewType: '对外发文'
    }
  })
}

export async function notifySendConfirmed(
  initiatorUid: string,
  docTitle: string,
  reviewId: number
) {
  const baseUrl = getNotifyBaseUrl()

  await deliverReviewNotification({
    touser: initiatorUid,
    title: '对外发文发送登记完成',
    description: `对外发文《${docTitle}》已完成发送登记，待确认对方接收。`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '查看详情',
    eventType: 'codocs.review.send_confirmed',
    category: 'document_review',
    severity: 'success',
    bizType: 'document_review',
    bizId: reviewId,
    idempotencyKey: codocsNotificationIdempotencyKey('review-send-confirmed', reviewId),
    metadata: {
      notificationKind: 'business_event',
      reviewId,
      initiatorUid,
      reviewType: '对外发文'
    }
  })
}

export async function notifyPendingReceive(
  senderUid: string,
  docTitle: string,
  reviewId: number
) {
  const baseUrl = getNotifyBaseUrl()

  await deliverReviewNotification({
    touser: senderUid,
    title: '对外发文接收跟进提醒',
    description: `对外发文《${docTitle}》已完成发送登记，请跟进对方接收情况并及时确认。`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '查看详情',
    eventType: 'codocs.review.receive_pending',
    category: 'document_review',
    severity: 'warning',
    bizType: 'document_review',
    bizId: reviewId,
    idempotencyKey: codocsNotificationIdempotencyKey('review-receive-pending', reviewId),
    metadata: {
      notificationKind: 'business_event',
      reviewId,
      senderUid,
      reviewType: '对外发文'
    }
  })
}

export async function notifyReceiveConfirmed(
  initiatorUid: string,
  docTitle: string,
  reviewId: number
) {
  const baseUrl = getNotifyBaseUrl()

  await deliverReviewNotification({
    touser: initiatorUid,
    title: '对外发文接收确认完成',
    description: `对外发文《${docTitle}》已确认对方接收。`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '查看详情',
    eventType: 'codocs.review.receive_confirmed',
    category: 'document_review',
    severity: 'success',
    bizType: 'document_review',
    bizId: reviewId,
    idempotencyKey: codocsNotificationIdempotencyKey('review-receive-confirmed', reviewId),
    metadata: {
      notificationKind: 'business_event',
      reviewId,
      initiatorUid,
      reviewType: '对外发文'
    }
  })
}

/**
 * 通知发起人 - 审批驳回
 */
export async function notifyRejected(
  initiatorUid: string,
  docTitle: string,
  reviewId: number,
  rejectReason: string,
  context?: ReviewNotifyContext
) {
  const baseUrl = getNotifyBaseUrl()
  const isOutsideReview = isOutsideReviewContext(context)
  const targetLabel = getReviewTargetLabel(docTitle, context)

  await deliverReviewNotification({
    touser: initiatorUid,
    title: isOutsideReview ? '对外发文审批被驳回' : '文档审批被驳回',
    description: `您提交的${targetLabel}已被驳回，原因：${rejectReason}`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '查看详情',
    eventType: 'codocs.review.rejected',
    category: 'document_review',
    severity: 'error',
    bizType: 'document_review',
    bizId: reviewId,
    idempotencyKey: codocsNotificationIdempotencyKey(
      'review-rejected',
      reviewId,
      context?.eventVersion || rejectReason
    ),
    metadata: {
      notificationKind: 'business_event',
      reviewId,
      reviewType: context?.reviewType || null,
      archiveKey: context?.archiveKey || null,
      initiatorUid,
      eventVersion: context?.eventVersion || null
    }
  })
}

/**
 * 发送提醒消息
 */
export async function sendReminder(
  reviewers: string[],
  docTitle: string,
  reviewId: number,
  nodeName: string,
  requestIdempotencyKey: string,
  context?: ReviewNotifyContext
) {
  const baseUrl = getNotifyBaseUrl()
  const isOutsideReview = isOutsideReviewContext(context)
  const targetLabel = getReviewTargetLabel(docTitle, context)

  await deliverReviewNotification({
    touser: reviewers,
    title: isOutsideReview ? '对外发文审批提醒' : '文档审阅提醒',
    description: `提醒：${targetLabel}${isOutsideReview ? '等待您审批' : '等待您审阅'}，当前环节：${nodeName}`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: isOutsideReview ? '立即审批' : '立即审阅',
    eventType: 'codocs.review.manual_reminder',
    category: 'document_review',
    severity: 'warning',
    bizType: 'document_review',
    bizId: reviewId,
    idempotencyKey: codocsNotificationIdempotencyKey(
      'review-manual-reminder',
      requestIdempotencyKey,
      reviewId,
      nodeName
    ),
    metadata: {
      notificationKind: 'manual_reminder',
      requestKeyHash: codocsNotificationIdempotencyKey('request', requestIdempotencyKey),
      reviewId,
      reviewType: context?.reviewType || null,
      archiveKey: context?.archiveKey || null,
      nodeName
    }
  })
}

/**
 * 归档分类 → 前端路由映射
 */
const ARCHIVE_ROUTE_MAP: Record<string, string> = {
  对外发文: '/departments/outsides',
  公司制度: '/company/rules',
  通知公告: '/company/notice',
  法务合规: '/company/legal',
  产品资料: '/products',
  知识库: '/company/knowledge',
  企业文化: '/company/culture',
  技术规范: '/company/tech-specs',
  文档模板: '/company/templates',
  会议记录: '/departments/records',
  投票表决: '/departments/records',
  部门规章: '/departments/rules'
}

/**
 * 通知发布范围内成员 - 审批通过并完成归档发布后
 */
export async function notifyPublished(
  scope: 'department' | 'company',
  docTitle: string,
  archiveKey: string,
  documentUuid: string,
  deptCode?: string | null,
  options: { event?: H3Event, archiveOssPath?: string } = {}
) {
  let recipients: string[] = []

  if (scope === 'department') {
    if (!deptCode) {
      console.warn('[ReviewNotify] Skip department publish notification: missing deptCode')
      return
    }
    recipients = await getDepartmentMemberUids(deptCode, options.event)
  } else {
    recipients = await getCompanyMemberUids(options.event)
  }

  recipients = [...new Set(recipients)]

  if (recipients.length === 0) {
    console.warn(`[ReviewNotify] Skip ${scope} publish notification: no recipients found`)
    return
  }

  const route = ARCHIVE_ROUTE_MAP[archiveKey] || (scope === 'department' ? '/departments' : '/company/rules')
  const pagePath = publishedAssetPagePath(options.archiveOssPath || '') || route
  const target = new URL(pagePath, 'https://codocs.invalid')
  const url = new URL(options.event
    ? resolveCurrentAppUrl(options.event, target.pathname)
    : `${getNotifyBaseUrl().replace(/\/$/, '')}${target.pathname}`)
  url.search = target.search
  const isOutsideReview = archiveKey === '对外发文'

  await deliverReviewNotification({
    touser: recipients,
    title: isOutsideReview
      ? '对外发文发布通知'
      : (scope === 'department' ? '部门文档发布通知' : '公司文档发布通知'),
    description: isOutsideReview
      ? `对外发文《${docTitle}》已确认发布，现已归档至部门文档/对外发文，请及时查阅。`
      : `文档《${docTitle}》已审批通过并发布到${scope === 'department' ? '部门范围' : '公司范围'}，请及时查阅。`,
    url: url.toString(),
    btntxt: '查看文档',
    eventType: 'codocs.document.published',
    category: 'document_publish',
    severity: 'success',
    bizType: 'document',
    bizId: documentUuid,
    idempotencyKey: codocsNotificationIdempotencyKey('document-published', documentUuid, archiveKey, scope),
    metadata: {
      notificationKind: 'business_event',
      documentUuid,
      archiveKey,
      publishScope: scope,
      departmentCode: deptCode || null,
      recipientCount: recipients.length
    }
  })
}
