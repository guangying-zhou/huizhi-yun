/**
 * 上传应用Logo到OSS
 * 路由: POST /api/oss/upload-logo
 * Body: multipart/form-data, 字段名 file
 * 返回: { code, message, data: { url } }
 */
import OSS from 'ali-oss'
import { randomBytes } from 'crypto'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml']
const MAX_SIZE = 2 * 1024 * 1024 // 2MB

function getExtFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg'
  }
  return map[mime] || 'png'
}

export default defineEventHandler(async (event) => {
  const formData = await readMultipartFormData(event)
  if (!formData?.length) {
    throw createError({ statusCode: 400, message: '请上传文件' })
  }

  const file = formData.find(f => f.name === 'file') ?? formData[0]
  if (!file || !file.data?.length) {
    throw createError({ statusCode: 400, message: '文件内容为空' })
  }

  const contentType = file.type || 'image/png'
  if (!ALLOWED_TYPES.includes(contentType)) {
    throw createError({ statusCode: 400, message: '只允许上传图片文件（PNG、JPG、GIF、WebP、SVG）' })
  }

  if (file.data.length > MAX_SIZE) {
    throw createError({ statusCode: 400, message: '文件大小不能超过 2MB' })
  }

  const ext = getExtFromMime(contentType)
  const random = randomBytes(4).toString('hex')
  const ossPath = `logos/logo_${Date.now()}_${random}.${ext}`

  const config = useRuntimeConfig()
  const ossConfig = config.ossImages as {
    bucketName: string
    bucketDomain: string
    endpoint: string
    accessKeyId: string
    accessKeySecret: string
    region: string
  }

  if (!ossConfig.bucketName || !ossConfig.accessKeyId || !ossConfig.accessKeySecret) {
    throw createError({ statusCode: 500, message: 'OSS 未配置，请联系管理员' })
  }

  try {
    const client = new OSS({
      region: ossConfig.region,
      accessKeyId: ossConfig.accessKeyId,
      accessKeySecret: ossConfig.accessKeySecret,
      bucket: ossConfig.bucketName,
      endpoint: `https://${ossConfig.endpoint}`
    })

    await client.put(ossPath, Buffer.from(file.data), {
      headers: { 'Content-Type': contentType }
    })

    const domain = ossConfig.bucketDomain || `${ossConfig.bucketName}.${ossConfig.endpoint}`
    const url = `https://${domain}/${ossPath}`

    return {
      code: 0,
      message: '上传成功',
      data: { url }
    }
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('[OSS] 上传 Logo 失败:', error.message)
    throw createError({ statusCode: 500, message: '上传失败，请重试' })
  }
})
