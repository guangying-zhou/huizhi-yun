import { getCookie } from 'h3'
import { resolveConsoleAuthContext, shouldUseLegacyAuthBridge } from '../../utils/consoleOidc'
import type { ConsoleAuthRequestContext } from '../../utils/consoleOidc'

export default defineEventHandler(async (event) => {
  const resolvedContext = event.context.consoleAuth as ConsoleAuthRequestContext | undefined
  const consoleAuth = resolvedContext?.authenticated
    ? resolvedContext
    : await resolveConsoleAuthContext(event)

  if (consoleAuth.authenticated) {
    return {
      authenticated: true,
      provider: 'console_oidc',
      uid: consoleAuth.uid || null,
      subjectCode: consoleAuth.subjectCode || null,
      tenant: consoleAuth.tenant || null,
      deployment: consoleAuth.deployment || null,
      policyVersion: consoleAuth.policyVersion || null,
      claims: consoleAuth.claims || null
    }
  }

  if (shouldUseLegacyAuthBridge(event)) {
    const uid = String(getCookie(event, 'auth_user') || '').trim()
    const token = String(getCookie(event, 'token') || '').trim()
    return {
      authenticated: Boolean(uid && token),
      provider: 'legacy',
      uid: uid || null,
      subjectCode: null,
      tenant: null,
      deployment: null,
      policyVersion: null,
      claims: null
    }
  }

  return {
    authenticated: false,
    provider: 'console_oidc',
    uid: null,
    subjectCode: null,
    tenant: null,
    deployment: null,
    policyVersion: null,
    claims: null
  }
})
