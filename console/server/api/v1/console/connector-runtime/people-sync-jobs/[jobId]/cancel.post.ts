export default defineEventHandler(() => {
  throw createError({ statusCode: 410, message: '请在 People「设置 / 人事事实源」取消钉钉同步任务。' })
})
