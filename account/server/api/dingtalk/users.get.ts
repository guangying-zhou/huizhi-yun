/**
 * 获取钉钉人员列表
 * GET /api/dingtalk/users
 */
import pinyinModule from 'pinyin'
import { getAllUsers, getDepartmentNameMap, isDingtalkConfigured } from '~~/server/utils/dingtalk'

const pinyinFn = (typeof pinyinModule === 'function' ? pinyinModule : (pinyinModule as { default: unknown }).default) as ((text: string, options?: unknown) => string[][]) & {
  compare?: (a: string, b: string) => number
}

export default defineEventHandler(async (event) => {
  const uid = getCookie(event, 'auth_user')
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })

  if (!isDingtalkConfigured()) {
    throw createError({ statusCode: 503, message: '钉钉服务未配置' })
  }

  const [users, deptNameMap] = await Promise.all([
    getAllUsers(),
    getDepartmentNameMap()
  ])

  const enriched = users.map(u => ({
    userid: u.userid,
    name: u.name,
    mobile: u.mobile || '',
    email: u.email || '',
    title: u.title || '',
    avatar: u.avatar || '',
    active: u.active !== false,
    dept_codes: u.dept_id_list || [],
    dept_names: (u.dept_id_list || []).map(id => deptNameMap.get(id) || `部门${id}`).join(', ')
  })).sort((a, b) => {
    const compare = pinyinFn.compare?.(a.name, b.name) ?? a.name.localeCompare(b.name, 'zh-CN')
    if (compare !== 0) return compare
    return a.userid.localeCompare(b.userid)
  })

  return {
    code: 0,
    data: {
      users: enriched,
      total: enriched.length
    }
  }
})
