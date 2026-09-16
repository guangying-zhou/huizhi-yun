import { createError, getHeader, readMultipartFormData } from 'h3'
import {
  putConsoleOSSAvatar,
  updateConsoleDirectoryOwnAvatar
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import {
  resolveConsoleSession,
  shouldWriteLegacyAuthCookies,
  writeLegacyAuthCookies
} from '~~/server/utils/authSession'
import { resolveConsoleRuntimeBinding } from '~~/server/utils/consoleRuntimeBinding'
import {
  buildProfileAvatarPath,
  PROFILE_AVATAR_MAX_MULTIPART_BYTES,
  validateProfileAvatar
} from '~~/server/utils/profileAvatar'

export default defineEventHandler(async (event) => {
  const session = await resolveConsoleSession(event, { allowLegacyFallback: false })
  const binding = resolveConsoleRuntimeBinding(event)

  const contentLength = Number(getHeader(event, 'content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > PROFILE_AVATAR_MAX_MULTIPART_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: 'AVATAR_TOO_LARGE',
      message: '头像文件不能超过 3MB'
    })
  }

  const parts = await readMultipartFormData(event)
  const avatarParts = (parts || []).filter(part => part.name === 'avatar' && part.filename)
  if (avatarParts.length !== 1) {
    throw createError({ statusCode: 400, message: '请选择一个头像文件' })
  }

  const avatar = avatarParts[0]!
  const validated = validateProfileAvatar(avatar.type, avatar.data)
  const avatarPath = buildProfileAvatarPath(
    binding.tenantId,
    session.uid,
    validated.extension,
    avatar.data
  )
  const objectKey = `avatars/${avatarPath}`
  try {
    await putConsoleOSSAvatar(event, {
      integrationCode: process.env.HZY_OSS_INTEGRATION_CODE || 'oss.default',
      objectPath: objectKey,
      contentBase64: avatar.data.toString('base64'),
      contentType: validated.contentType
    })
  } catch (error) {
    console.error('[Console] profile avatar upload failed', {
      tenant: binding.tenantId,
      uid: session.uid,
      error: error instanceof Error ? error.message : String(error)
    })
    throw createError({
      statusCode: 502,
      statusMessage: 'AVATAR_UPLOAD_FAILED',
      message: '头像上传到对象存储失败，请稍后重试'
    })
  }

  const runtime = await updateConsoleDirectoryOwnAvatar(event, {
    avatarPath,
    contentType: validated.contentType,
    size: avatar.data.length
  })

  if (shouldWriteLegacyAuthCookies(event)) {
    writeLegacyAuthCookies(event, session.sessionId, {
      ...session.user,
      avatar: avatarPath,
      avatarUrl: avatarPath
    })
  }

  return {
    code: 0,
    message: 'ok',
    data: runtime.data
  }
})
