import { getSignedUrl } from '../../../utils/oss'
import { getCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'
import { CABINET_TEXT_PREVIEW_EXTENSIONS, readCabinetTextPreview } from '~~/server/utils/cabinetTextPreview'

const PPTX_EXTENSIONS = new Set(['pptx'])

const PREVIEWABLE_EXTENSIONS = new Set([
  'pdf',
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg',
  'mp4', 'mp3', 'wav'
])

const OFFICE_EXTENSIONS = new Set(['doc', 'docx'])

const CONVERTIBLE_EXTENSIONS = new Set(['doc', 'docx'])

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件 ID 不能为空' })
  }

  const query = getQuery(event)
  const deptCode = String(query.dept_code || query.deptCode || '').trim()
  const file = await getCabinetFileMetadata(event, 'department', id, { departmentCode: deptCode })
  const departmentQuery = `?dept_code=${encodeURIComponent(deptCode)}`

  const textPreview = CABINET_TEXT_PREVIEW_EXTENSIONS.has(file.file_ext)
  const previewable = PREVIEWABLE_EXTENSIONS.has(file.file_ext) || textPreview
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
        preview_url: `/api/dept-cabinet/${id}/preview-pptx${departmentQuery}`,
        convertible,
        original_name: file.original_name,
        file_ext: file.file_ext,
        file_size: file.file_size
      }
    }
  }

  if (officePreview) {
    return {
      success: true,
      data: {
        previewable: true,
        preview_type: 'office',
        preview_url: `/api/dept-cabinet/${id}/preview-html${departmentQuery}`,
        convertible,
        original_name: file.original_name,
        file_ext: file.file_ext,
        file_size: file.file_size
      }
    }
  }

  if (textPreview) {
    const preview = await readCabinetTextPreview(event, file.oss_path)
    return {
      success: true,
      data: {
        previewable: true,
        preview_type: 'text',
        content: preview.content,
        encoding: preview.encoding,
        truncated: preview.truncated,
        convertible,
        original_name: file.original_name,
        file_ext: file.file_ext,
        file_size: file.file_size
      }
    }
  }

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
