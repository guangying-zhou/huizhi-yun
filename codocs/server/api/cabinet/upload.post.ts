import { v4 as uuidv4 } from 'uuid'
import { createOSSClient } from '../../utils/oss'
import { createCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'

// 100MB limit
const MAX_FILE_SIZE = 100 * 1024 * 1024

// 允许的文件扩展名
const ALLOWED_EXTENSIONS = new Set([
  'doc', 'docx', 'ppt', 'pptx',
  'pdf', 'txt', 'csv', 'rtf',
  'zip', 'rar', '7z', 'tar', 'gz',
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg',
  'mp4', 'mp3', 'wav', 'avi', 'mov',
  'json', 'xml', 'yaml', 'yml',
  'html', 'css', 'js', 'ts',
  'java', 'py', 'go', 'rs', 'c', 'cpp', 'h',
  'sql', 'sh', 'bat'
])

export default defineEventHandler(async (event) => {
  const multipart = await readMultipartFormData(event)
  if (!multipart) {
    throw createError({ statusCode: 400, message: '没有上传文件' })
  }

  const ownerUid = multipart.find(x => x.name === 'owner_uid')?.data.toString()
  const folderIdStr = multipart.find(x => x.name === 'folder_id')?.data.toString()
  const folderId = folderIdStr && folderIdStr !== 'null' ? parseInt(folderIdStr) : null

  if (!ownerUid) {
    throw createError({ statusCode: 400, message: '所有者不能为空' })
  }

  const files = multipart.filter(x => x.filename)

  if (files.length === 0) {
    throw createError({ statusCode: 400, message: '请选择文件' })
  }

  // 大文件上传需要更长的超时时间（5分钟）
  const client = createOSSClient({ timeout: 300000 })
  const results = {
    success: 0,
    failed: 0,
    items: [] as { filename: string, status: string, message?: string }[]
  }

  for (const file of files) {
    const originalName = file.filename || 'unknown'
    const ext = originalName.split('.').pop()?.toLowerCase() || ''

    // 不允许上传 .md 文件（md 文件应使用文档管理功能）
    if (ext === 'md') {
      results.failed++
      results.items.push({ filename: originalName, status: 'error', message: 'Markdown 文件请使用文档管理功能上传' })
      continue
    }

    // 检查文件扩展名
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      results.failed++
      results.items.push({ filename: originalName, status: 'error', message: `不支持的文件类型: .${ext}` })
      continue
    }

    // 检查文件大小
    if (file.data.length > MAX_FILE_SIZE) {
      results.failed++
      results.items.push({ filename: originalName, status: 'error', message: '文件大小不能超过 100MB' })
      continue
    }

    try {
      const uuid = uuidv4()
      const sanitizedName = originalName.replace(/[\\/:*?"<>|]/g, '_')
      const ossPath = `codocs/users/${ownerUid}/cabinet/${uuid}.${ext}`

      // 获取 MIME 类型
      const contentType = getContentType(ext)

      // 上传到 OSS
      await client.put(ossPath, file.data, {
        headers: { 'Content-Type': contentType }
      })

      await createCabinetFileMetadata(event, 'personal', {
        uuid,
        filename: sanitizedName,
        original_name: originalName,
        file_ext: ext,
        file_size: file.data.length,
        oss_path: ossPath,
        owner_uid: ownerUid,
        folder_id: folderId
      })

      results.success++
      results.items.push({ filename: originalName, status: 'success' })
    } catch (err: unknown) {
      const error = err as { message?: string }
      console.error(`[Cabinet Upload] Failed: ${originalName}`, err)
      results.failed++
      results.items.push({ filename: originalName, status: 'error', message: error.message || '上传失败' })
    }
  }

  return results
})

function getContentType(ext: string): string {
  const map: Record<string, string> = {
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt': 'text/plain',
    'csv': 'text/csv',
    'rtf': 'application/rtf',
    'zip': 'application/zip',
    'rar': 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'bmp': 'image/bmp',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'mp4': 'video/mp4',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'json': 'application/json',
    'xml': 'application/xml',
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript'
  }
  return map[ext] || 'application/octet-stream'
}
