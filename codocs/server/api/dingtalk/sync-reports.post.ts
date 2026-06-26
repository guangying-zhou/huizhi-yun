export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    message: 'Codocs tenant-runtime contract is required for DingTalk report sync.'
  })
})
