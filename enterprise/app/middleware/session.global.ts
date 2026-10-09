export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server || ['/login', '/aims/login', '/assets/login', '/enterprise/login'].includes(to.path)) return
  const { $enterpriseSession } = useNuxtApp()
  try {
    const scope = await $enterpriseSession.refresh()
    if (!scope) return navigateTo({ path: String(useRuntimeConfig().public.enterpriseLoginPath || '/login'), query: { redirect: to.fullPath } })
  } catch {
    throw createError({ statusCode: 503, statusMessage: '企业会话验证暂不可用' })
  }
})
