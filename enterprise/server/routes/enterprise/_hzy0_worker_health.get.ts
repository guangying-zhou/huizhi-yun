import { createError, setHeader } from 'h3'
import { isLocalWorkerHealthRequest } from '@hzy/foundation/server/utils/localWorkerHealth'

export default defineEventHandler((event) => {
  if (!isLocalWorkerHealthRequest(event)) throw createError({ statusCode: 404 })
  setHeader(event, 'cache-control', 'no-store')
  return { status: 'ok', pid: process.pid, rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed }
})
