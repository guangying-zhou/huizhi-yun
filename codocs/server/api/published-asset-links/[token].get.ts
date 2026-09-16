import { defineEventHandler, getRouterParam, setHeader } from 'h3'
import { resolvePublishedAssetShortLink } from '~~/server/utils/publishedAssetShortLinks'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const data = await resolvePublishedAssetShortLink(event, getRouterParam(event, 'token'))
  return { code: 0, data }
})
