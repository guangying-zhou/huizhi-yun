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
  'sql', 'sh', 'bat',
  'xls', 'xlsx'
])

export default defineEventHandler(async (event) => {
  const multipart = await readMultipartFormData(event)
  if (!multipart) {
    throw createError({ statusCode: 400, message: '没有上传文件' })
  }

  const ownerUid = multipart.find(x => x.name === 'owner_uid')?.data.toString()
  const deptCode = multipart.find(x => x.name === 'dept_code')?.data.toString()
  const projectCode = multipart.find(x => x.name === 'project_code')?.data.toString()
  const folderIdStr = multipart.find(x => x.name === 'folder_id')?.data.toString()
  const folderId = folderIdStr && folderIdStr !== 'null' ? parseInt(folderIdStr) : null

  if (!ownerUid) {
    throw createError({ statusCode: 400, message: '上传人不能为空' })
  }

  if (!deptCode) {
    throw createError({ statusCode: 400, message: '部门编码不能为空' })
  }

  const files = multipart.filter(x => x.filename)

  if (files.length === 0) {
    throw createError({ statusCode: 400, message: '请选择文件' })
  }

  const client = createOSSClient({ timeout: 300000 })
  const results = {
    success: 0,
    failed: 0,
    items: [] as {
      filename: string
      status: string
      message?: string
      uuid?: string
      ossPath?: string
      fileExt?: string
      fileSize?: number
    }[]
  }

  for (const file of files) {
    const originalName = file.filename || 'unknown'
    const ext = originalName.split('.').pop()?.toLowerCase() || ''

    if (ext === 'md') {
      results.failed++
      results.items.push({ filename: originalName, status: 'error', message: 'Markdown 文件请使用文档管理功能上传' })
      continue
    }

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      results.failed++
      results.items.push({ filename: originalName, status: 'error', message: `不支持的文件类型: .${ext}` })
      continue
    }

    if (file.data.length > MAX_FILE_SIZE) {
      results.failed++
      results.items.push({ filename: originalName, status: 'error', message: '文件大小不能超过 100MB' })
      continue
    }

    try {
      const uuid = uuidv4()
      const sanitizedName = originalName.replace(/[\\/:*?"<>|]/g, '_')
      const ossPath = projectCode
        ? `codocs/projects/${safePathSegment(projectCode)}/cabinet/${uuid}.${ext}`
        : `codocs/departments/${safePathSegment(deptCode)}/cabinet/${uuid}.${ext}`

      const contentType = getContentType(ext)

      await client.put(ossPath, file.data, {
        headers: { 'Content-Type': contentType }
      })

      await createCabinetFileMetadata(event, 'department', {
        uuid,
        filename: sanitizedName,
        original_name: originalName,
        file_ext: ext,
        file_size: file.data.length,
        oss_path: ossPath,
        owner_uid: ownerUid,
        dept_code: deptCode,
        folder_id: folderId
      })

      results.success++
      results.items.push({
        filename: originalName,
        status: 'success',
        uuid,
        ossPath,
        fileExt: ext,
        fileSize: file.data.length
      })
    } catch (err: unknown) {
      const error = err as { message?: string }
      console.error(`[Dept Cabinet Upload] Failed: ${originalName}`, err)
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
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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

function safePathSegment(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|\s]+/g, '_')
}
