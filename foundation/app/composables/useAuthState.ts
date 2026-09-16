export function useAuthState() {
  const { cookieOptions } = useCookieOptions()
  const opts = cookieOptions()

  const user = useCookie<string | null | undefined>('auth_user', opts)
  const token = useCookie<string | null | undefined>('token', opts)
  const userEmail = useCookie<string | null | undefined>('auth_email', opts)
  const userRole = useCookie<string | null | undefined>('auth_role', opts)
  const userRealname = useCookie<string | null | undefined>('auth_realname', opts)
  const userNickname = useCookie<string | null | undefined>('auth_nickname', opts)
  const userAvatar = useCookie<string | null | undefined>('auth_avatar', opts)
  const userDepartment = useCookie<string | null | undefined>('auth_department', opts)
  const userDeptCode = useCookie<string | null | undefined>('auth_dept_code', opts)
  const userMobileTail4 = useCookie<string | null | undefined>('auth_mobile_tail4', opts)

  const authenticated = computed(() => {
    const tokenValue = String(token.value || '').trim()
    const userValue = String(user.value || '').trim()
    return Boolean(
      tokenValue
      && tokenValue !== 'null'
      && tokenValue !== 'undefined'
      && userValue
    )
  })

  return {
    authenticated,
    user,
    token,
    userEmail,
    userRole,
    userRealname,
    userNickname,
    userAvatar,
    userDepartment,
    userDeptCode,
    userMobileTail4
  }
}
