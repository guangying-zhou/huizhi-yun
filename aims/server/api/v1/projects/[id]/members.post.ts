/**
 * 项目成员新增已迁移到 tenant-runtime。
 *
 * 正常请求会被 server/middleware/tenant-runtime.ts 转发到 data-runtime；
 * 若执行到这里，说明 tenant-runtime 未启用，不能回退本地 DB 写入。
 */
export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    message: 'Aims tenant-runtime is required to add project members.'
  })
})
