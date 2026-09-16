import { useDatabase } from '../../utils/database'
import { uploadToOSS, getAvatarPath, deleteFromOSS } from '../../utils/oss'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDatabase()

  // Get current user from cookies - support both auth_email and auth_user
  const authEmail = getCookie(event, 'auth_email')
  const authUser = getCookie(event, 'auth_user')

  if (!authEmail && !authUser) {
    throw createError({
      statusCode: 401,
      message: '请先登录'
    })
  }

  try {
    // Get uid - either directly from auth_user or lookup by email
    let ldapUid: string

    if (authUser) {
      ldapUid = authUser
    } else {
      const [users] = await pool.query(
        'SELECT uid FROM user_status_cache WHERE email = ?',
        [authEmail]
      ) as [RowDataPacket[], unknown]

      if (users.length === 0 || !users[0]) {
        throw createError({
          statusCode: 404,
          message: '用户不存在'
        })
      }
      ldapUid = users[0].uid
    }

    // Parse multipart form data
    const formData = await readMultipartFormData(event)

    if (!formData || formData.length === 0) {
      throw createError({
        statusCode: 400,
        message: '请上传头像文件'
      })
    }

    const file = formData.find(f => f.name === 'avatar')

    if (!file || !file.data) {
      throw createError({
        statusCode: 400,
        message: '请上传头像文件'
      })
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!file.type || !allowedTypes.includes(file.type)) {
      throw createError({
        statusCode: 400,
        message: '只支持 JPEG、PNG、GIF、WebP 格式的图片'
      })
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024
    if (file.data.length > maxSize) {
      throw createError({
        statusCode: 400,
        message: '图片大小不能超过 5MB'
      })
    }

    // Get file extension
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp'
    }
    const ext = extMap[file.type] || 'jpg'

    // Upload to OSS - returns the path
    const ossPath = getAvatarPath(ldapUid, ext)
    const avatarUrl = `avatars/${encodeURIComponent(ossPath)}`
    await uploadToOSS(avatarUrl, file.data, file.type)

    // Get old avatar to delete
    const [profiles] = await pool.query(
      'SELECT id, avatar FROM system_users WHERE uid = ?',
      [ldapUid]
    ) as [RowDataPacket[], unknown]

    const oldAvatar = profiles[0]?.avatar || null

    // Update or create profile with new avatar
    if (profiles.length === 0) {
      await pool.query(
        'INSERT INTO system_users (uid, avatar) VALUES (?, ?)',
        [ldapUid, ossPath]
      )
    } else {
      await pool.query(
        'UPDATE system_users SET avatar = ? WHERE uid = ?',
        [ossPath, ldapUid]
      )
    }

    // Delete old avatar from OSS (async, don't wait)
    if (oldAvatar) {
      deleteFromOSS(`avatars/${oldAvatar}`).catch((err) => {
        console.error('Failed to delete old avatar:', err)
      })
    }

    return {
      code: 0,
      message: '头像上传成功',
      data: {
        avatar: ossPath
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('上传头像失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '上传头像失败'
    })
  }
})
