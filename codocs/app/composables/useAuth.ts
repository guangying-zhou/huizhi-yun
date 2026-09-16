export function useAuth() {
  const consoleOidc = useConsoleOidcAuth()
  const auth = consoleOidc.enabled.value
    ? consoleOidc
    : {
        ...useLegacyAuthBridge(),
        enabled: ref(false),
        idToken: ref(null),
        tenant: ref(null),
        subjectCode: ref(null),
        policyVersion: ref(null),
        claims: ref(null)
      }

  return {
    ...auth,
    userMobileTail: auth.userMobileTail4
  }
}
