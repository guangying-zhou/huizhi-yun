export default defineEventHandler(async (event): Promise<unknown> => {
  await requireWebDevPermission(event, 'webdev_workspace', 'admin')
  return await devAgentFetch(event, '/runtime/enrollment')
})
