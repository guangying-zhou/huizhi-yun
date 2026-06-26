import { createError } from 'h3'

export async function ensureAttachmentTable(): Promise<void> {
  throw createError({
    statusCode: 500,
    message: 'Local attachment DB helpers are retired. Use runtime-backed document links.'
  })
}
