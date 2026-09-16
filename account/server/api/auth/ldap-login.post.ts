import { defineEventHandler, readBody, createError, setCookie } from 'h3'
import { verifyLdapPassword } from '~~/server/utils/ldap'
import { getAuthCookieOptions } from '@hzy/foundation/server/utils/cookie-domain'
import { queryRows, execute } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'
import { logLoginFromEvent } from '~~/server/utils/log'
import { randomUUID } from 'crypto'

interface LoginRequest {
  uid: string
  password: string
  rememberMe?: boolean
  targetApp?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<LoginRequest>(event)

  if (!body.uid || !body.password) {
    throw createError({
      statusCode: 400,
      message: '用户名和密码不能为空'
    })
  }

  const uid = body.uid
  const password = body.password

  // 1. Get User DN from LDAP (or construct it if we knew the structure, but safest is to search or bind)
  // Actually verifyLdapPassword takes DN. We might need to find DN first using uid (uid).
  // server/utils/ldap.ts has getLdapUserDn(uid).

  // Wait, verifyLdapPassword signature is (dn, password).
  // Let's check if we can get DN.
  const { getLdapUserDn } = await import('~~/server/utils/ldap')

  let dn: string | null = null
  try {
    dn = await getLdapUserDn(uid)
  } catch (e) {
    console.error('LDAP Error getting DN:', e)
    // If we can't get DN, maybe user doesn't exist in LDAP
  }

  if (!dn) {
    await logLoginFromEvent(event, {
      uid,
      targetApp: body.targetApp || 'account',
      loginType: 'password',
      loginResult: 0,
      failureReason: 'LDAP user DN not found'
    })
    throw createError({
      statusCode: 401,
      message: '用户不存在或密码错误'
    })
  }

  // 2. Verify Password
  const isValid = await verifyLdapPassword(dn, password)
  if (!isValid) {
    await logLoginFromEvent(event, {
      uid,
      targetApp: body.targetApp || 'account',
      loginType: 'password',
      loginResult: 0,
      failureReason: 'Invalid password'
    })
    throw createError({
      statusCode: 401,
      message: '用户不存在或密码错误'
    })
  }

  // 3. Sync/Get User from DB
  // Check if user exists in system_users
  const userRows = await queryRows<RowDataPacket[]>(
    'SELECT id, email, uid, status, real_name, avatar FROM system_users WHERE uid = ?',
    [uid]
  )

  let userId: number
  let email: string = ''
  let status: number = 1
  let realName: string = ''
  let avatar: string = ''

  if (userRows.length > 0) {
    const user = userRows[0]
    if (!user) {
      throw createError({
        statusCode: 500,
        message: '无法读取用户信息'
      })
    }

    userId = user.id
    email = user.email || ''
    status = user.status
    realName = user.real_name || ''
    avatar = normalizeAvatarOutput(user.avatar) || ''
    if (status === 0) {
      await logLoginFromEvent(event, {
        uid,
        targetApp: body.targetApp || 'account',
        loginType: 'password',
        loginResult: 0,
        failureReason: 'Account disabled'
      })
      throw createError({
        statusCode: 403,
        message: '账户已被禁用'
      })
    }
  } else {
    const insertRes = await execute(
      'INSERT INTO system_users (uid, status, created_at, updated_at) VALUES (?, 1, NOW(), NOW())',
      [uid]
    )
    userId = insertRes.insertId
  }

  // 4. Set Cookies
  const maxAge = body.rememberMe ? 60 * 60 * 24 * 7 : 60 * 60 * 24 // 7 days or 24 hours
  const cookieOptions = getAuthCookieOptions(event, { maxAge })
  const sessionId = randomUUID()

  setCookie(event, 'token', sessionId, cookieOptions)
  setCookie(event, 'auth_user', uid, cookieOptions)
  if (email) {
    setCookie(event, 'auth_email', email, cookieOptions)
  }
  setCookie(event, 'auth_realname', realName, cookieOptions)
  setCookie(event, 'auth_avatar', avatar, cookieOptions)
  setCookie(event, 'auth_id', String(userId), cookieOptions)

  // 5. Log
  await logLoginFromEvent(event, {
    uid,
    targetApp: body.targetApp || 'account',
    loginType: 'password',
    loginResult: 1,
    sessionId
  })

  return { success: true, user: { uid } }
})
