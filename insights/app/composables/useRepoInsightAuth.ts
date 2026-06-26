export function useRepoInsightAuth() {
  const token = useCookie('token')
  const user = useCookie('auth_user')
  const email = useCookie('auth_email')

  const isAuthenticated = computed(() => !!token.value)

  function logout() {
    token.value = null
    user.value = null
    email.value = null
    navigateTo('/login')
  }

  return {
    token,
    user,
    email,
    isAuthenticated,
    logout
  }
}
