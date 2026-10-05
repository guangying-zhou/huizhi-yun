import { createError, defineEventHandler, getRequestURL } from 'h3'

const fixed = new Set([
  'GET /api/workflow-proxy/instances/by-biz',
  'GET /api/workflow-proxy/instances/by-biz-history',
  'GET /api/workflow-proxy/tasks/pending'
])
const instance = /^GET \/api\/workflow-proxy\/instances\/[1-9]\d*$/u
const task = /^(?:GET \/api\/workflow-proxy\/tasks\/[1-9]\d*|POST \/api\/workflow-proxy\/tasks\/[1-9]\d*\/(?:approve|reject))$/u
// The Host shared API base serves the same seven operations (Foundation
// sharedApiPath); both spellings pass the identical exact boundary.
const hostShared = '/enterprise/api/foundation/workflow-proxy/'

export default defineEventHandler((event) => {
  const requested = getRequestURL(event).pathname
  const path = requested.startsWith(hostShared) ? `/api/workflow-proxy/${requested.slice(hostShared.length)}` : requested
  if (!path.startsWith('/api/workflow-proxy/')) return
  const key = `${event.method.toUpperCase()} ${path}`
  if (fixed.has(key) || instance.test(key) || task.test(key)) return
  throw createError({ statusCode: 404, message: 'Workflow operation is not registered in Enterprise' })
})
