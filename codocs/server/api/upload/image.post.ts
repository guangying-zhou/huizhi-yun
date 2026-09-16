import { createError, defineEventHandler, readMultipartFormData } from 'h3'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { getCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'
import { uploadImage } from '~~/server/utils/oss'

export default defineEventHandler(async (event) => {
  const ownerId = requireRequestUid(event)
  const files = await readMultipartFormData(event)
  if (!files || files.length === 0) {
    throw createError({ statusCode: 400, message: 'No file uploaded' })
  }

  const file = files.find(f => f.name === 'file') || files[0]
  if (!file?.filename || !file.data) {
    throw createError({ statusCode: 400, message: 'Invalid file data' })
  }
  if (!file.type || !file.type.startsWith('image/')) {
    throw createError({ statusCode: 400, message: 'Only image files are allowed' })
  }

  const documentIdField = files.find(f => f.name === 'documentId')
  const documentId = documentIdField?.data?.toString('utf-8') || ''
  const meta: Record<string, string> = {}
  if (documentId) {
    try {
      const doc = await getCodocsDocumentMetadata(event, documentId, { actorUid: ownerId })
      if (doc.oss_path) {
        meta['doc-path'] = encodeURIComponent(doc.oss_path)
      }
    } catch (error) {
      console.warn('[Image Upload] Failed to lookup doc oss_path:', error)
    }
  }

  try {
    const url = await uploadImage(file.data, file.filename, ownerId, meta)
    return {
      success: true,
      url,
      name: file.filename
    }
  } catch (error) {
    console.error('Image upload failed:', error)
    throw createError({ statusCode: 500, message: 'Image upload failed' })
  }
})
