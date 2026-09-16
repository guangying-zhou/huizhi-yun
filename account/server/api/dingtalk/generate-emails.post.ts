/**
 * 为钉钉用户生成邮箱
 * POST /api/dingtalk/generate-emails
 *
 * 将中文姓名转为小写全拼 + @COMPANY_DOMAIN
 * 重名自动添加数字后缀
 */
import pinyinModule from 'pinyin'

// ESM/CJS interop: pinyin v4 may export { default: fn } in some bundlers
const pinyinFn = (typeof pinyinModule === 'function' ? pinyinModule : (pinyinModule as { default: unknown }).default) as (text: string, options?: unknown) => string[][]

export default defineEventHandler(async (event) => {
  const uid = getCookie(event, 'auth_user')
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })

  const body = await readBody<{ users: Array<{ userid: string, name: string, email?: string }>, replaceExisting?: boolean }>(event)

  if (!body?.users || !Array.isArray(body.users)) {
    throw createError({ statusCode: 400, message: '请提供 users 数组' })
  }

  const config = useRuntimeConfig()
  const domain = config.companyDomain || 'wiztek.cn'

  // 追踪已使用的邮箱前缀以处理重名
  const usedPrefixes = new Map<string, number>()

  const replaceExisting = body.replaceExisting || false

  const results = body.users.map((user) => {
    // 已有邮箱且不替换的跳过
    if (user.email && !replaceExisting) {
      return { userid: user.userid, name: user.name, email: user.email, generated: false }
    }

    // 转拼音：获取每个字的拼音数组（不带声调）
    const py = pinyinFn(user.name, {
      style: 0, // STYLE_NORMAL = 0 (不带声调)
      heteronym: false
    })
    const prefix = py.map((item: string[]) => item[0]).join('').toLowerCase()

    // 处理重名
    let finalPrefix = prefix
    const count = usedPrefixes.get(prefix) || 0
    if (count > 0) {
      finalPrefix = `${prefix}${count + 1}`
    }
    usedPrefixes.set(prefix, count + 1)

    return {
      userid: user.userid,
      name: user.name,
      email: `${finalPrefix}@${domain}`,
      generated: true
    }
  })

  return {
    code: 0,
    data: {
      results,
      total: results.length,
      generated: results.filter(r => r.generated).length
    }
  }
})
