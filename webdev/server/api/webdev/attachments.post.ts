const MAX_ATTACHMENT_FILES = 8
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export default defineEventHandler(async (event): Promise<unknown> => {
  const parts = await readMultipartFormData(event)
  if (!parts?.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'At least one attachment is required'
    })
  }

  const form = new FormData()
  let fileCount = 0

  for (const part of parts) {
    if (!part.filename) continue
    if (fileCount >= MAX_ATTACHMENT_FILES) {
      throw createError({
        statusCode: 400,
        statusMessage: `At most ${MAX_ATTACHMENT_FILES} attachment files are allowed`
      })
    }
    if (part.data.byteLength > MAX_ATTACHMENT_BYTES) {
      throw createError({
        statusCode: 400,
        statusMessage: `${part.filename} exceeds ${MAX_ATTACHMENT_BYTES} bytes`
      })
    }

    const filename = part.filename.replace(/[\\/]+/g, '-').trim() || `attachment-${fileCount + 1}`
    const contentType = part.type || 'application/octet-stream'
    form.append('files', new Blob([part.data as BlobPart], { type: contentType }), filename)
    fileCount += 1
  }

  if (fileCount === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'At least one attachment file is required'
    })
  }

  return await devAgentFetch(event, '/v1/attachments', {
    method: 'POST',
    body: form
  })
})
