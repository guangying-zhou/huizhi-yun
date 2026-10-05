import { fetchDirectoryUser } from '~~/server/utils/directoryCompat'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { getCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'
import {
  buildCodocsNotification,
  codocsNotificationIdempotencyKey,
  requireCodocsNotificationRequestKey
} from '~~/server/utils/codocsNotificationBuilders'

interface DocumentRow {
  title: string
  owner_uid: string
}

export default defineEventHandler(async (event) => {
  const uuid = getRouterParam(event, 'uuid')
  const actorUid = requireRequestUid(event, '未登录')
  const body = await readBody(event)
  const { toUid, message } = body

  if (!uuid || !toUid) {
    throw createError({ statusCode: 400, message: '缺少必填参数' })
  }

  const doc = await getCodocsDocumentMetadata(event, uuid, { actorUid }) as DocumentRow
  const requestKey = requireCodocsNotificationRequestKey(event, 'Shared document update reminder')

  // 获取发送者姓名
  let actorName = actorUid
  try {
    const actorInfo = await fetchDirectoryUser(actorUid)
    if (actorInfo?.realName) {
      actorName = actorInfo.realName
    }
  } catch {
    // 用 uid 兜底
  }

  const docTitle = doc.title || '无标题文档'
  const config = useRuntimeConfig()
  const baseUrl = config.public.siteUrl || 'https://codocs.wiztek.cn'

  // 拼接描述
  let description = `${actorName}已对你共享的《${docTitle}》做了修改，请你查看`
  if (message?.trim()) {
    description += `\n附言：${message.trim()}`
  }

  await sendNotification(buildCodocsNotification({
    touser: toUid,
    title: '共享文档修改提醒',
    description,
    url: `${baseUrl}/documents/${uuid}?fromShare=1`,
    btntxt: '查看文档',
    eventType: 'codocs.document.share_update_reminder',
    category: 'document_share',
    severity: 'info',
    bizType: 'document',
    bizId: uuid,
    idempotencyKey: codocsNotificationIdempotencyKey('document-share-update-reminder', requestKey, uuid, toUid),
    metadata: {
      notificationKind: 'manual_reminder',
      requestKeyHash: codocsNotificationIdempotencyKey('request', requestKey),
      documentUuid: uuid,
      actorUid,
      targetUid: toUid
    }
  }))

  return { success: true }
})
