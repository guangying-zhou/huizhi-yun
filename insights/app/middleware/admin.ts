// middleware/admin.ts — 管理员权限检查
export default defineNuxtRouteMiddleware(() => {
  const token = useCookie('token')
  if (!token.value) {
    return navigateTo('/login')
  }
  // TODO: 从 Account 模块获取角色信息进行权限检查
})
