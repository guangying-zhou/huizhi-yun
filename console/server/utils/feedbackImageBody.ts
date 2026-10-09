import { createHash } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
// Consume a bounded binary stream. The private Runtime command signs all bytes;
// no multipart filenames, unbounded readBody, filesystem or public object URL.
export async function readFeedbackImage(event: H3Event) {
  const contentType = getHeader(event, 'content-type') || ''
  if (!['image/png', 'image/jpeg'].includes(contentType)) throw createError({ statusCode: 415 })
  const limit = 5 * 1024 * 1024
  if (Number(getHeader(event, 'content-length')) > limit) throw createError({ statusCode: 413 })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > limit) throw createError({ statusCode: 413 })
    chunks.push(bytes)
  }
  if (!size) throw createError({ statusCode: 400 })
  const bytes = Buffer.concat(chunks)
  return { image: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex'), contentType }
}
