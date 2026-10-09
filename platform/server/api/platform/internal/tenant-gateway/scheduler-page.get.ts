import { ok } from '~~/server/utils/api'
import { queryRows } from '~~/server/utils/db'
import { listTenantGatewaySchedulerPageWithQueries } from '~~/server/utils/tenantGatewaySchedulerRegistry'

function integerQuery(value: unknown, name: string, minimum: number, maximum: number) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `${name} must be between ${minimum} and ${maximum}` })
  }
  return parsed
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const slot = integerQuery(query.slot, 'slot', 0, Number.MAX_SAFE_INTEGER)
  const shardCount = integerQuery(query.shardCount, 'shardCount', 1, 256)
  const shardIndex = integerQuery(query.shardIndex, 'shardIndex', 0, shardCount - 1)
  const limit = integerQuery(query.limit, 'limit', 1, 100)
  const windowSize = integerQuery(query.windowSize, 'windowSize', 1, 500)
  const cursor = String(query.cursor || '').trim()
  if (cursor.length > 1000) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'cursor is too long' })
  }
  try {
    return ok(await listTenantGatewaySchedulerPageWithQueries(
      { queryRows },
      { slot, shardIndex, shardCount, limit, windowSize, ...(cursor ? { cursor } : {}) }
    ))
  } catch (error) {
    if (error instanceof TypeError) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: error.message })
    }
    throw error
  }
})
