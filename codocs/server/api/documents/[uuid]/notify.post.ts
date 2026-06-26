import { fetchDirectoryUser } from '~~/server/utils/directoryCompat'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { getCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'

interface DocumentRow {
  title: string
  owner_uid: string
}

export default defineEventHandler(async (event) => {
  const uuid = getRouterParam(event, 'uuid')
  const body = await readBody(event)
  const { toUid, message } = body
  const actorUid = requireRequestUid(event, '未登录')

  if (!uuid || !toUid) {
    throw createError({ statusCode: 400, message: '缺少必填参数' })
  }

  const doc = await getCodocsDocumentMetadata(event, uuid, { actorUid }) as DocumentRow

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

  await sendNotification({
    touser: toUid,
    title: '共享文档修改提醒',
    description,
    url: `${baseUrl}/documents/${uuid}?fromShare=1`,
    btntxt: '查看文档'
  })

  return { success: true }
})
