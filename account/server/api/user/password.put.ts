import { verifyLdapPassword, changeLdapPassword, getLdapUserDn } from '~~/server/utils/ldap'
import { logOperation } from '~~/server/utils/log'
import { queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface UserRow extends RowDataPacket {
  id: number
  uid: string
  real_name: string
  email: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { oldPassword, newPassword } = body

  if (!oldPassword || !newPassword) {
    throw createError({
      statusCode: 400,
      message: 'oldPassword and newPassword are required'
    })
  }

  // Get current user from session
  // Assuming auth_user cookie contains uid
  const ldapUid = getCookie(event, 'auth_user')
  if (!ldapUid) {
    throw createError({
      statusCode: 401,
      message: 'Not authenticated'
    })
  }

  // Get user info from DB for logging
  const users = await queryRows<UserRow[]>(
    'SELECT id, uid, real_name, email FROM system_users WHERE uid = ? OR email = ?',
    [ldapUid, ldapUid] // Try to match uid or email as fallback if auth_user is not strictly uid
  )

  // If not found in system_users, try to find in org_persons or just use basic info
  let userId = 0
  let uid = ldapUid

  if (users.length > 0 && users[0]) {
    userId = users[0].id
    uid = users[0].uid || users[0].email
  }

  const ipAddress = event.node.req.socket.remoteAddress || null

  // 1. Get User DN
  const userDn = await getLdapUserDn(ldapUid)
  if (!userDn) {
    throw createError({
      statusCode: 404,
      message: 'User not found in LDAP'
    })
  }

  // 2. Verify Old Password
  const isValid = await verifyLdapPassword(userDn, oldPassword)
  if (!isValid) {
    // Log failed attempt
    await logOperation({
      userId,
      uid,
      sourceApp: 'account',
      action: 'change_password_failed',
      detail: 'Old password verification failed',
      result: 'failed',
      ipAddress
    })

    throw createError({
      statusCode: 400,
      message: 'Old password is incorrect'
    })
  }

  // 3. Change Password
  try {
    await changeLdapPassword(userDn, newPassword)

    // 4. Log Success
    await logOperation({
      userId,
      uid,
      sourceApp: 'account',
      action: 'change_password',
      detail: 'Password changed successfully',
      result: 'success',
      ipAddress
    })

    return {
      success: true,
      message: 'Password changed successfully'
    }
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('Password change error:', error)
    await logOperation({
      userId,
      uid,
      sourceApp: 'account',
      action: 'change_password_error',
      detail: `Error: ${error.message}`,
      result: 'failed',
      ipAddress
    })

    throw createError({
      statusCode: 500,
      message: 'Failed to update password'
    })
  }
})
