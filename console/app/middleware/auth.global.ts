export default defineNuxtRouteMiddleware(async (to) => {
  if (
    to.path.startsWith('/api/')
    || to.path.startsWith('/oauth/')
    || to.path.startsWith('/.well-known/')
  ) {
    return
  }

  if (to.path === '/activation' || to.path === '/login') {
    return
  }

  try {
    const response = await $fetch<{
      code: number
      data?: {
        authenticated?: boolean
      }
    }>('/api/v1/console/auth/me')

    if (response.data?.authenticated) {
      return
    }
  } catch {
    // Fall through to login redirect.
  }

  const { cookieOptions } = useCookieOptions()
  const logoutMarker = useCookie<string | null | undefined>('console_logged_out', cookieOptions())

  return navigateTo({
    path: '/login',
    query: {
      redirect: to.fullPath,
      ...(logoutMarker.value === '1' ? { logged_out: '1' } : {})
    }
  }, { replace: true })
})
