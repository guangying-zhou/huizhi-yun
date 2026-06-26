/**
 * 审阅通知工具 — 基于通用通知封装的审阅场景快捷方法
 */
import { getRoleMemberUids } from './accountPermissions'
import { fetchDirectoryData } from './directoryCompat'
import type { AccountUsersData } from '~/types/account'

interface DepartmentMember {
  uid?: string
}

interface ReviewNotifyContext {
  reviewType?: string | null
  archiveKey?: string | null
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

async function getDepartmentMemberUids(deptCode: string) {
  const response = await fetchDirectoryData<{ items?: DepartmentMember[] }>(`/departments/${encodeURIComponent(deptCode)}/members`, {
    timeout: 10000
  })

  if (!Array.isArray(response.items)) {
    return []
  }

  return response.items
    .map(member => member.uid)
    .filter((uid): uid is string => Boolean(uid))
}

async function getCompanyMemberUids() {
  const response = await fetchDirectoryData<AccountUsersData>('/users', {
    timeout: 10000
  })

  if (!response.items) {
    return []
  }

  return response.items
    .map(user => user.uid)
    .filter((uid): uid is string => Boolean(uid))
}

/**
 * @deprecated 使用 sendNotification 代替
 */
export const sendReviewNotification = sendNotification

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

  await sendNotification({
    touser: reviewers,
    title: isOutsideReview ? '对外发文审批通知' : '文档审阅通知',
    description: `您有一份${targetLabel}${isOutsideReview ? '待审批' : '待审阅'}，当前环节：${nodeName}`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: isOutsideReview ? '立即审批' : '立即审阅'
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

  await sendNotification({
    touser: initiatorUid,
    title: isOutsideReview ? '对外发文审批通过' : '文档审批通过',
    description: `您提交的${targetLabel}已${isOutsideReview ? '完成审批' : '通过全部审批'}，请确认发布`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '确认发布'
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

  await sendNotification({
    touser: leaderUid,
    title: '对外发文审批完成通知',
    description: `对外发文《${docTitle}》已完成一般文件审批，请知悉。`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '查看详情'
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

  await sendNotification({
    touser: recipients,
    title: '对外发文用章提醒',
    description: `对外发文《${docTitle}》已确认发布，待公章管理员办理盖章。`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '查看详情'
  })
}

export async function notifySealConfirmed(
  initiatorUid: string,
  docTitle: string,
  reviewId: number
) {
  const baseUrl = getNotifyBaseUrl()

  await sendNotification({
    touser: initiatorUid,
    title: '对外发文盖章完成',
    description: `对外发文《${docTitle}》已完成盖章，请继续确认发送。`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '查看详情'
  })
}

export async function notifySendConfirmed(
  initiatorUid: string,
  docTitle: string,
  reviewId: number
) {
  const baseUrl = getNotifyBaseUrl()

  await sendNotification({
    touser: initiatorUid,
    title: '对外发文发送登记完成',
    description: `对外发文《${docTitle}》已完成发送登记，待确认对方接收。`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '查看详情'
  })
}

export async function notifyPendingReceive(
  senderUid: string,
  docTitle: string,
  reviewId: number
) {
  const baseUrl = getNotifyBaseUrl()

  await sendNotification({
    touser: senderUid,
    title: '对外发文接收跟进提醒',
    description: `对外发文《${docTitle}》已完成发送登记，请跟进对方接收情况并及时确认。`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '查看详情'
  })
}

export async function notifyReceiveConfirmed(
  initiatorUid: string,
  docTitle: string,
  reviewId: number
) {
  const baseUrl = getNotifyBaseUrl()

  await sendNotification({
    touser: initiatorUid,
    title: '对外发文接收确认完成',
    description: `对外发文《${docTitle}》已确认对方接收。`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '查看详情'
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

  await sendNotification({
    touser: initiatorUid,
    title: isOutsideReview ? '对外发文审批被驳回' : '文档审批被驳回',
    description: `您提交的${targetLabel}已被驳回，原因：${rejectReason}`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: '查看详情'
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
  context?: ReviewNotifyContext
) {
  const baseUrl = getNotifyBaseUrl()
  const isOutsideReview = isOutsideReviewContext(context)
  const targetLabel = getReviewTargetLabel(docTitle, context)

  await sendNotification({
    touser: reviewers,
    title: isOutsideReview ? '对外发文审批提醒' : '文档审阅提醒',
    description: `提醒：${targetLabel}${isOutsideReview ? '等待您审批' : '等待您审阅'}，当前环节：${nodeName}`,
    url: `${baseUrl}/reviews/${reviewId}`,
    btntxt: isOutsideReview ? '立即审批' : '立即审阅'
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
  deptCode?: string | null
) {
  const baseUrl = getNotifyBaseUrl()
  let recipients: string[] = []

  if (scope === 'department') {
    if (!deptCode) {
      console.warn('[ReviewNotify] Skip department publish notification: missing deptCode')
      return
    }
    recipients = await getDepartmentMemberUids(deptCode)
  } else {
    recipients = await getCompanyMemberUids()
  }

  recipients = [...new Set(recipients)]

  if (recipients.length === 0) {
    console.warn(`[ReviewNotify] Skip ${scope} publish notification: no recipients found`)
    return
  }

  const route = ARCHIVE_ROUTE_MAP[archiveKey] || (scope === 'department' ? '/departments' : '/company/rules')
  const isOutsideReview = archiveKey === '对外发文'

  await sendNotification({
    touser: recipients,
    title: isOutsideReview
      ? '对外发文发布通知'
      : (scope === 'department' ? '部门文档发布通知' : '公司文档发布通知'),
    description: isOutsideReview
      ? `对外发文《${docTitle}》已确认发布，现已归档至部门文档/对外发文，请及时查阅。`
      : `文档《${docTitle}》已审批通过并发布到${scope === 'department' ? '部门范围' : '公司范围'}，请及时查阅。`,
    url: `${baseUrl}${route}`,
    btntxt: '查看文档'
  })
}
