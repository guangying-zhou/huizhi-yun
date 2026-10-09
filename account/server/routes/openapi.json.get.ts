import { getV1OpenAPIDocument } from '~~/server/utils/openapi'

export default defineEventHandler(async (event) => {
  return await getV1OpenAPIDocument(event)
})
