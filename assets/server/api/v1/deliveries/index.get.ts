import { getQuery } from 'h3'
import { ok } from '~~/server/utils/assetsApi'
import { listDeliveriesFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'deliveries', 'view')

  const query = getQuery(event)
  const search = typeof query.search === 'string' ? query.search : undefined
  const status = typeof query.status === 'string' ? query.status : undefined

  return ok(await listDeliveriesFromDb({ search, status }))
})
