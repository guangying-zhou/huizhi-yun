export function useAuth() {
  const consoleOidc = useConsoleOidcAuth()
  if (consoleOidc.enabled.value) {
    return consoleOidc
  }

  const bridge = useLegacyAuthBridge()

  return {
    authenticated: bridge.authenticated,
    user: bridge.user,
    token: bridge.token,
    idToken: ref(null),
    logout: bridge.logout,
    handleRouteAccess: bridge.handleRouteAccess,
    userEmail: bridge.userEmail,
    userRole: bridge.userRole,
    userRealname: bridge.userRealname,
    userNickname: bridge.userNickname,
    userAvatar: bridge.userAvatar,
    userDepartment: bridge.userDepartment,
    userDeptCode: bridge.userDeptCode,
    userMobileTail4: bridge.userMobileTail4,
    tenant: ref(null),
    subjectCode: ref(null),
    policyVersion: ref(null),
    claims: ref(null)
  }
}
