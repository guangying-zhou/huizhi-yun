export default defineEventHandler(async (event): Promise<unknown> => {
  return await devAgentFetch(event, '/runtime/enrollment')
})
