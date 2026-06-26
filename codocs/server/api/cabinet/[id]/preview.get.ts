import { getSignedUrl } from '../../../utils/oss'
import { getCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'

const PPTX_EXTENSIONS = new Set(['pptx'])

// 可以直接在浏览器中预览的文件类型
const PREVIEWABLE_EXTENSIONS = new Set([
  'pdf',
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg',
  'txt', 'csv', 'json', 'xml', 'html', 'css', 'js', 'ts',
  'java', 'py', 'go', 'rs', 'c', 'cpp', 'h', 'sql', 'sh', 'yaml', 'yml',
  'mp4', 'mp3', 'wav'
])

// Office 文件通过服务端转换预览
const OFFICE_EXTENSIONS = new Set([
  'doc', 'docx'
])

// 可转为 Markdown 的文件类型
const CONVERTIBLE_EXTENSIONS = new Set([
  'doc', 'docx'
])

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件 ID 不能为空' })
  }

  const file = await getCabinetFileMetadata(event, 'personal', id)

  const previewable = PREVIEWABLE_EXTENSIONS.has(file.file_ext)
  const pptxPreview = PPTX_EXTENSIONS.has(file.file_ext)
  const officePreview = OFFICE_EXTENSIONS.has(file.file_ext)
  const convertible = CONVERTIBLE_EXTENSIONS.has(file.file_ext)

  if (!previewable && !officePreview && !pptxPreview) {
    return {
      success: true,
      data: {
        previewable: false,
        convertible,
        original_name: file.original_name,
        file_ext: file.file_ext,
        file_size: file.file_size
      }
    }
  }

  if (pptxPreview) {
    return {
      success: true,
      data: {
        previewable: true,
        preview_type: 'pptx',
        preview_url: `/api/cabinet/${id}/preview-pptx`,
        convertible,
        original_name: file.original_name,
        file_ext: file.file_ext,
        file_size: file.file_size
      }
    }
  }

  if (officePreview) {
    // Office 文件：返回服务端转换预览的 URL
    return {
      success: true,
      data: {
        previewable: true,
        preview_type: 'office',
        preview_url: `/api/cabinet/${id}/preview-html`,
        convertible,
        original_name: file.original_name,
        file_ext: file.file_ext,
        file_size: file.file_size
      }
    }
  }

  // 生成签名 URL（内联显示，不触发下载）
  const signedUrl = await getSignedUrl(file.oss_path, 3600)

  return {
    success: true,
    data: {
      previewable: true,
      preview_type: 'direct',
      preview_url: signedUrl,
      convertible,
      original_name: file.original_name,
      file_ext: file.file_ext,
      file_size: file.file_size
    }
  }
})
