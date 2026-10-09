/**
 * 一键关联企业微信用户到本地
 * POST /api/wecom/users-bindall
 *
 * 从企业微信通讯录拉取全员，按姓名匹配本地 system_users，更新 wecom_id
 * 姓名重复时跳过，避免误关联
 */
import { fetchWecomUsers, isWecomConfigured } from '~~/server/utils/wecom'
import { queryRows, execute } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface LocalUserRow extends RowDataPacket {
  id: number
  uid: string
  real_name: string | null
  wecom_id: string | null
  status: number
}

export default defineEventHandler(async (event) => {
  const uid = getCookie(event, 'auth_user')
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })

  if (!isWecomConfigured()) {
    throw createError({ statusCode: 503, message: '企业微信服务未配置' })
  }

  // 1. 从企业微信拉取全员
  const wecomUsers = await fetchWecomUsers(1)

  // 2. 查询本地用户，按姓名建索引
  const localUsers = await queryRows<LocalUserRow[]>(
    'SELECT id, uid, real_name, wecom_id, status FROM system_users WHERE user_type = 1 AND status != -1'
  )

  const localByName = new Map<string, LocalUserRow[]>()
  for (const user of localUsers) {
    if (user.real_name) {
      const name = user.real_name.trim()
      if (!localByName.has(name)) localByName.set(name, [])
      localByName.get(name)!.push(user)
    }
  }

  let linked = 0
  let alreadyLinked = 0
  let notFound = 0
  let duplicateName = 0
  const details: Array<{
    wecomUserId: string
    name: string
    status: string
    localUid?: string
  }> = []

  for (const wecomUser of wecomUsers) {
    // 跳过未激活/已禁用
    if (wecomUser.status && wecomUser.status !== 1) {
      details.push({
        wecomUserId: wecomUser.userid,
        name: wecomUser.name,
        status: 'inactive_skipped'
      })
      continue
    }

    const name = (wecomUser.name || '').trim()
    const candidates = localByName.get(name)

    if (!candidates || candidates.length === 0) {
      notFound++
      details.push({
        wecomUserId: wecomUser.userid,
        name: wecomUser.name,
        status: 'not_matched'
      })
      continue
    }

    if (candidates.length > 1) {
      duplicateName++
      details.push({
        wecomUserId: wecomUser.userid,
        name: wecomUser.name,
        status: 'duplicate_name_skipped'
      })
      continue
    }

    const matched = candidates[0]!

    if (matched.wecom_id === wecomUser.userid) {
      alreadyLinked++
      details.push({
        wecomUserId: wecomUser.userid,
        name: wecomUser.name,
        status: 'already_linked',
        localUid: matched.uid
      })
      continue
    }

    await execute(
      'UPDATE system_users SET wecom_id = ? WHERE id = ?',
      [wecomUser.userid, matched.id]
    )

    linked++
    details.push({
      wecomUserId: wecomUser.userid,
      name: wecomUser.name,
      status: 'linked',
      localUid: matched.uid
    })
  }

  return {
    code: 0,
    data: {
      wecomTotal: wecomUsers.length,
      linked,
      alreadyLinked,
      notFound,
      duplicateName,
      details
    }
  }
})
