export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) {
    return
  }

  if (
    to.path === '/activation'
    || to.path === '/login'
    || to.path.startsWith('/api/')
    || to.path.startsWith('/auth/')
  ) {
    return
  }

  const response = await $fetch<{ code: number, data: { activated: boolean } }>('/api/activation/status', {
    cache: 'no-store'
  }).catch(() => null)
  if (response?.data?.activated) {
    return
  }

  return navigateTo({
    path: '/activation',
    query: {
      redirect: to.fullPath
    }
  }, { replace: true })
})
