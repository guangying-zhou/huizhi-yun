import { createOidcTokenRenewal } from '../utils/oidcTokenRenewal'

// Keeps the short-lived Console access token fresh while a page stays open.
// Route changes already refresh an expired token; this covers pages that stay
// on one route and keep issuing background requests.
export default defineNuxtPlugin(() => {
  const auth = useConsoleOidcAuth()
  if (!auth.enabled.value) return
  const renewal = createOidcTokenRenewal({
    getExpiry: () => (auth.token.value ? auth.claims.value?.exp : null),
    refresh: () => auth.refresh()
  })
  watch(() => [auth.token.value, auth.claims.value?.exp], () => renewal.schedule(), { immediate: true })
  const wake = () => {
    if (document.visibilityState === 'visible') void renewal.wake()
  }
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('focus', wake)
})
