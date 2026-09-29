import { verifyInternalApi } from '~~/server/utils/internalApi'
import { createProjectDocumentContent } from '~~/server/utils/projectDocumentCreation'

export default defineEventHandler(async (event) => {
  await verifyInternalApi(event, { scopes: ['codocs:documents:write'] })
  return await createProjectDocumentContent(event, await readBody(event))
})
