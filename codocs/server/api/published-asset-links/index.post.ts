import { defineEventHandler, readBody, setHeader } from 'h3'
import { createPublishedAssetShortLink } from '~~/server/utils/publishedAssetShortLinks'
import { requireRequestUid } from '~~/server/utils/authIdentity'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  requireRequestUid(event)
  const body = await readBody<{ path?: unknown }>(event)
  const data = await createPublishedAssetShortLink(event, body?.path)
  return { code: 0, data }
})
