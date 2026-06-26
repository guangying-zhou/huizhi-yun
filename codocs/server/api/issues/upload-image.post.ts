/**
 * Issue 图片上传
 * POST /api/issues/upload-image
 * 存储路径: codocs/issues/images/{uuid}.{ext}
 * 使用公共读 bucket，返回永久公开 URL
 */
import { createImagesOSSClient, getImagesPublicUrl } from '../../utils/oss'
import { v4 as uuidv4 } from 'uuid'
import { requireRequestUid } from '~~/server/utils/authIdentity'

export default defineEventHandler(async (event) => {
  requireRequestUid(event)

  const files = await readMultipartFormData(event)
  if (!files || files.length === 0) {
    throw createError({ statusCode: 400, message: '未上传文件' })
  }

  const file = files.find(f => f.name === 'file') || files[0]
  if (!file || !file.filename || !file.data) {
    throw createError({ statusCode: 400, message: '无效文件' })
  }

  if (!file.type || !file.type.startsWith('image/')) {
    throw createError({ statusCode: 400, message: '仅支持图片文件' })
  }

  try {
    const client = createImagesOSSClient()
    const ext = file.filename.split('.').pop()?.toLowerCase() || 'png'
    const uniqueName = `${uuidv4()}.${ext}`
    const ossPath = `codocs/issues/images/${uniqueName}`
    const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`

    await client.put(ossPath, file.data, {
      headers: { 'Content-Type': mimeType }
    })

    return {
      success: true,
      url: getImagesPublicUrl(ossPath),
      ossPath,
      name: file.filename
    }
  } catch (err: unknown) {
    console.error('[Issue Upload] Failed:', err)
    throw createError({ statusCode: 500, message: '图片上传失败' })
  }
})
