export default defineEventHandler(async (event): Promise<unknown> => {
  await requireWebDevPermission(event, 'webdev_workspace', 'view')
  return await devAgentFetch(event, '/runtime/health')
})
