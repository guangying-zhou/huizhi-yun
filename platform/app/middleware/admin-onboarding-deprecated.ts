export default defineNuxtRouteMiddleware(() => {
  return navigateTo('/admin/subscriptions', { replace: true })
})
