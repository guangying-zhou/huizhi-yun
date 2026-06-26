/**
 * 推荐文章给个人或部门
 * 路由: POST /api/info/recommend
 *
 * 通过企业微信发送推荐消息
 */
import { fetchDirectoryData } from '~~/server/utils/directoryCompat'

interface RecommendBody {
  articleTitle: string
  articleId: number | string
  senderName: string
  toUsers?: string[]
  toDepts?: string[]
  message?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<RecommendBody>(event)

  if (!body?.articleTitle) {
    throw createError({ statusCode: 400, message: '缺少文章标题' })
  }

  if ((!body.toUsers || body.toUsers.length === 0) && (!body.toDepts || body.toDepts.length === 0)) {
    throw createError({ statusCode: 400, message: '请选择推荐对象' })
  }

  const senderName = body.senderName || '有人'
  const title = '文章推荐'
  let description = `${senderName}觉得《${body.articleTitle}》这篇文章值得一读，特向你推荐，请你抽空阅读。`
  if (body.message?.trim()) {
    description += `\n附言：${body.message.trim()}`
  }

  const config = useRuntimeConfig()
  const baseUrl = (config.public as { siteUrl?: string }).siteUrl || 'https://codocs.wiztek.cn'
  const url = `${baseUrl}/info/${body.articleId}`

  const results: Array<{ target: string, success: boolean, error?: string }> = []

  // 发送给个人
  if (body.toUsers && body.toUsers.length > 0) {
    try {
      await sendNotification({
        touser: body.toUsers,
        title,
        description,
        url,
        btntxt: '阅读文章'
      })
      results.push({ target: 'users', success: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '发送失败'
      results.push({ target: 'users', success: false, error: msg })
    }
  }

  // 发送给部门
  if (body.toDepts && body.toDepts.length > 0) {
    try {
      const memberResults = await Promise.all(
        body.toDepts.map(deptCode =>
          fetchDirectoryData<{ items?: Array<{ uid?: string }> }>(`/departments/${encodeURIComponent(deptCode)}/members`)
        )
      )
      const deptUserUids = [...new Set(
        memberResults
          .flatMap(result => result.items || [])
          .map(member => member.uid)
          .filter((uid): uid is string => Boolean(uid))
      )]

      if (!deptUserUids.length) {
        results.push({ target: 'depts', success: false, error: '部门内没有可通知成员' })
      } else {
        await sendNotification({
          touser: deptUserUids,
          title,
          description,
          url,
          btntxt: '阅读文章'
        })
        results.push({ target: 'depts', success: true })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '发送失败'
      results.push({ target: 'depts', success: false, error: msg })
    }
  }

  const allSuccess = results.every(r => r.success)
  const anySuccess = results.some(r => r.success)

  return {
    success: anySuccess,
    message: allSuccess ? '推荐消息已发送' : anySuccess ? '部分发送成功' : '发送失败',
    data: { results }
  }
})
