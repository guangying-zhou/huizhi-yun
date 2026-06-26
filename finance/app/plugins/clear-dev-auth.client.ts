export default defineNuxtPlugin(() => {
  const { cookieOptions } = useCookieOptions()
  const opts = cookieOptions()
  const token = useCookie<string | null | undefined>('token', opts)
  const user = useCookie<string | null | undefined>('auth_user', opts)

  if (user.value !== 'finance-dev' && token.value !== 'finance-dev-token') return

  user.value = null
  token.value = null
  useCookie<string | null | undefined>('auth_realname', opts).value = null
  useCookie<string | null | undefined>('auth_nickname', opts).value = null
  useCookie<string | null | undefined>('auth_email', opts).value = null
  useCookie<string | null | undefined>('auth_role', opts).value = null
})
