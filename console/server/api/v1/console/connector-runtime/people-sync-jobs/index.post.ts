export default defineEventHandler(() => {
  throw createError({ statusCode: 410, message: '钉钉 People 同步已迁移到 People「设置 / 人事事实源」。' })
})
