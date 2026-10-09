import { proxyCurrentAppPath } from '@hzy/foundation/server/utils/apiAliasProxy'

export default defineEventHandler((event) => {
  const path = getRouterParam(event, 'path') || ''
  return proxyCurrentAppPath(event, `/api/v1/${path}`)
})
