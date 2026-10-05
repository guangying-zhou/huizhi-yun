export default defineEventHandler(() => {
  return {
    success: true,
    data: {
      service: 'platform',
      status: 'ok',
      timestamp: new Date().toISOString()
    }
  }
})
