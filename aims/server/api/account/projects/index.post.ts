/**
 * 创建项目注册表记录的旧兼容入口已下线。
 * 项目注册表写入统一通过 Console Directory 管理接口完成。
 * POST /api/account/projects
 */

export default defineEventHandler(() => {
  throw createError({
    statusCode: 410,
    message: '项目注册表写入已迁移到 Console Directory，请使用 Console 管理接口'
  })
})
