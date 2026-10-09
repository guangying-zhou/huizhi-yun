import { defineEventHandler, getQuery, setCookie, sendRedirect } from 'h3'
import { getAuthCookieOptions } from '@hzy/foundation/server/utils/cookie-domain'
import { sanitizeAuthRedirect } from '@hzy/foundation/server/utils/casAuth'
import { queryRows, execute } from '~~/server/utils/db'
import { logLoginFromEvent } from '~~/server/utils/log'
import { fetchWecomUserDetail } from '~~/server/utils/wecom'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const code = typeof q.code === 'string' ? q.code : ''
  const targetApp = typeof q.target_app === 'string' && q.target_app.trim() ? q.target_app.trim() : 'account'
  const redirect = sanitizeAuthRedirect(event, q.redirect)

  if (!code) {
    throw createError({ statusCode: 400, message: '缺少授权码' })
  }

  const config = useRuntimeConfig()
  const corpId = config.wecom.corpId
  const corpSecret = config.wecom.corpSecret

  // 获取 access_token
  const tokenUrl = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${corpSecret}`
  const tokenRes = await $fetch<{ errcode: number, errmsg: string, access_token?: string }>(tokenUrl)

  if (tokenRes.errcode !== 0 || !tokenRes.access_token) {
    throw createError({ statusCode: 500, message: `获取 access_token 失败: ${tokenRes.errmsg}` })
  }

  // 获取用户信息
  const userInfoUrl = `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${tokenRes.access_token}&code=${code}`
  const userInfo = await $fetch<{ errcode: number, errmsg: string, userid?: string, user_ticket?: string }>(userInfoUrl)

  if (userInfo.errcode !== 0 || !userInfo.userid) {
    throw createError({ statusCode: 401, message: `获取用户信息失败: ${userInfo.errmsg}` })
  }

  const wecomUserid = userInfo.userid

  // 1. 优先用 uid 匹配
  let userRows = await queryRows<RowDataPacket[]>(
    'SELECT id, uid, status, email, real_name, avatar FROM system_users WHERE uid = ?',
    [wecomUserid]
  )

  // 2. uid 匹配失败时，获取企业微信用户详情，用邮箱回落匹配
  if (userRows.length === 0) {
    try {
      const wecomDetail = await fetchWecomUserDetail(wecomUserid)
      const bizMail = wecomDetail.biz_mail?.trim()
      const personalEmail = wecomDetail.email?.trim()

      // 企业邮箱优先
      if (bizMail) {
        userRows = await queryRows<RowDataPacket[]>(
          'SELECT id, uid, status, email, real_name, avatar FROM system_users WHERE email = ?',
          [bizMail]
        )
      }
      // 个人邮箱回落
      if (userRows.length === 0 && personalEmail && personalEmail !== bizMail) {
        userRows = await queryRows<RowDataPacket[]>(
          'SELECT id, uid, status, email, real_name, avatar FROM system_users WHERE email = ?',
          [personalEmail]
        )
      }

      const matchedUser = userRows[0]
      if (matchedUser) {
        console.log(`[Wecom OAuth] uid "${wecomUserid}" 未匹配，通过邮箱 "${bizMail || personalEmail}" 匹配到用户 "${matchedUser.uid}"`)
      }
    } catch (err) {
      console.warn('[Wecom OAuth] 获取用户详情失败，跳过邮箱匹配:', err)
    }
  }

  let userId: number
  let matchedUid: string = wecomUserid
  let email: string = ''
  let realName: string = ''
  let avatar: string = ''

  if (userRows.length > 0) {
    const user = userRows[0]
    if (!user) {
      throw createError({ statusCode: 500, message: '无法读取用户信息' })
    }

    userId = user.id
    matchedUid = user.uid
    email = user.email || ''
    realName = user.real_name || ''
    avatar = normalizeAvatarOutput(user.avatar) || ''
    if (user.status === 0) {
      await logLoginFromEvent(event, {
        uid: matchedUid,
        targetApp,
        loginType: 'oauth',
        loginResult: 0,
        failureReason: 'Account disabled'
      })
      throw createError({ statusCode: 403, message: '账户已被禁用' })
    }
  } else {
    const insertRes = await execute(
      'INSERT INTO system_users (uid, status, created_at, updated_at) VALUES (?, 1, NOW(), NOW())',
      [wecomUserid]
    )
    userId = insertRes.insertId
  }

  // 设置 Cookies
  const cookieOptions = getAuthCookieOptions(event)
  setCookie(event, 'token', code, cookieOptions)
  setCookie(event, 'auth_user', matchedUid, cookieOptions)
  setCookie(event, 'auth_id', String(userId), cookieOptions)
  if (email) {
    setCookie(event, 'auth_email', email, cookieOptions)
  }
  setCookie(event, 'auth_realname', realName, cookieOptions)
  setCookie(event, 'auth_avatar', avatar, cookieOptions)

  // 记录日志
  await logLoginFromEvent(event, {
    uid: matchedUid,
    targetApp,
    loginType: 'oauth',
    loginResult: 1,
    sessionId: code
  })

  return sendRedirect(event, redirect || '/')
})
