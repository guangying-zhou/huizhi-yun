import { createHash } from 'node:crypto'
import { createError } from 'h3'

export const PROFILE_AVATAR_MAX_BYTES = 3 * 1024 * 1024
export const PROFILE_AVATAR_MAX_MULTIPART_BYTES = PROFILE_AVATAR_MAX_BYTES + 128 * 1024

const AVATAR_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
} as const

type SupportedAvatarType = keyof typeof AVATAR_TYPES

function hasPngSignature(data: Buffer) {
  return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
}

function hasJpegSignature(data: Buffer) {
  return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
}

function hasWebpSignature(data: Buffer) {
  return data.length >= 12
    && data.subarray(0, 4).toString('ascii') === 'RIFF'
    && data.subarray(8, 12).toString('ascii') === 'WEBP'
}

function hasSignature(contentType: SupportedAvatarType, data: Buffer) {
  if (contentType === 'image/png') return hasPngSignature(data)
  if (contentType === 'image/jpeg') return hasJpegSignature(data)
  return hasWebpSignature(data)
}

export function validateProfileAvatar(contentType: unknown, data: Buffer) {
  const normalizedType = String(contentType || '').trim().toLowerCase() as SupportedAvatarType
  const extension = AVATAR_TYPES[normalizedType]

  if (!extension) {
    throw createError({
      statusCode: 415,
      statusMessage: 'AVATAR_TYPE_UNSUPPORTED',
      message: '头像仅支持 PNG、JPEG 或 WebP 格式'
    })
  }
  if (!data.length) {
    throw createError({ statusCode: 400, message: '头像文件为空' })
  }
  if (data.length > PROFILE_AVATAR_MAX_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: 'AVATAR_TOO_LARGE',
      message: '头像文件不能超过 3MB'
    })
  }
  if (!hasSignature(normalizedType, data)) {
    throw createError({
      statusCode: 415,
      statusMessage: 'AVATAR_CONTENT_INVALID',
      message: '头像文件内容与格式不一致'
    })
  }

  return { contentType: normalizedType, extension }
}

function safeObjectSegment(value: unknown) {
  const normalized = String(value || '').trim().replace(/[^A-Za-z0-9._~-]+/g, '_')
  return normalized.replace(/^_+|_+$/g, '') || 'unknown'
}

export function buildProfileAvatarPath(tenantId: string, uid: string, extension: string, data: Buffer) {
  const digest = createHash('sha256').update(data).digest('hex').slice(0, 32)
  return `${safeObjectSegment(tenantId)}/${safeObjectSegment(uid)}/${digest}.${extension}`
}
