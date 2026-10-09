import handler from '~~/server/api/platform/_handlers/tenants/[id].patch'

// Keep the numeric legacy owning handler contract while sharing one Nitro parameter node.
export default defineEventHandler((event) => {
  event.context.params = { ...event.context.params, id: getRouterParam(event, 'tenantCode') || '' }
  return handler(event)
})
