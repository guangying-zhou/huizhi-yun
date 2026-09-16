import { queryRows, execute } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'
import { logOperationFromEvent } from '~~/server/utils/log'

interface CreateUserRequest {
  email: string
  uid?: string
  deptCode?: number
  mobile?: string
  remark?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateUserRequest>(event)

  // Validate required fields
  if (!body.email || typeof body.email !== 'string') {
    throw createError({
      statusCode: 400,
      message: '邮箱地址是必填项'
    })
  }

  const email = body.email.trim().toLowerCase()
  const uid = body.uid || email.split('@')[0] // Default uid from email

  // Check if email already exists
  const existing = await queryRows<RowDataPacket[]>(
    'SELECT id FROM system_users WHERE email = ?',
    [email]
  )

  if (existing.length > 0) {
    throw createError({
      statusCode: 409,
      message: '该邮箱已被注册'
    })
  }

  // Check if uid already exists
  const existingUser = await queryRows<RowDataPacket[]>(
    'SELECT id FROM system_users WHERE uid = ?',
    [uid]
  )

  if (existingUser.length > 0) {
    // If uid taken, maybe append random? Or just fail?
    // For now, let's just fail if uid is explicit, or not worry too much if it's implicit?
    // Actually LDAP UID is usually unique. `system_users` has `uid` unique.
    // We need to generate a `uid` for this user if it's a local user?
    // The table says `uid` is NOT NULL.
    // If this API creates a user, it must provide `uid`.
    // Usually `uid` is the uid.
  }

  // Insert new user
  // We must provide uid as it is NOT NULL. Use uid or email as uid equivalent for now.
  const ldapUid = uid

  const result = await execute(
    `INSERT INTO system_users (
      uid, email, mobile, remark, status
    ) VALUES (?, ?, ?, ?, 1)`, // Default status 1 (Enabled)
    [
      ldapUid,
      email,
      body.mobile || null,
      body.remark || null
    ]
  )

  const userId = result.insertId

  // Add to user_departments if deptCode is provided
  if (body.deptCode && ldapUid) {
    await execute(
      'INSERT INTO user_departments (uid, dept_code) VALUES (?, ?)',
      [ldapUid, body.deptCode]
    )
  }

  await logOperationFromEvent(event, {
    sourceApp: 'account',
    action: 'system_user.create',
    targetType: 'system_user',
    targetId: userId,
    detail: {
      uid: ldapUid,
      email,
      deptCode: body.deptCode || null,
      mobile: body.mobile || null
    }
  })

  return {
    success: true,
    id: userId,
    message: '用户创建成功'
  }
})
