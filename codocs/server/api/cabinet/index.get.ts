import { listCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const data = await listCabinetFileMetadata(event, 'personal', query)

  return { success: true, data: { items: data.items || [] } }
})
