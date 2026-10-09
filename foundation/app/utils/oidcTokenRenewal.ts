// Console access tokens are short-lived (15 minutes by default) while the
// Console session lasts hours. Refresh proactively so a page that stays open
// never sends background requests with an expired token.
export const OIDC_RENEW_BEFORE_EXPIRY_MS = 60_000
const MIN_DELAY_MS = 5_000

export interface OidcTokenRenewalOptions {
  /** Access-token expiry in seconds since epoch, or null when not signed in. */
  getExpiry: () => number | null | undefined
  refresh: () => Promise<unknown>
  now?: () => number
  setTimer?: (callback: () => void, delay: number) => unknown
  clearTimer?: (timer: unknown) => void
}

export function createOidcTokenRenewal(options: OidcTokenRenewalOptions) {
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay))
  const clearTimer = options.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>))
  let timer: unknown
  let renewing: Promise<void> | undefined
  // A failed renewal waits for a new token or an explicit wake (focus), so an
  // invalid refresh token never turns into a retry loop.
  let failedForExpiry: number | undefined

  const dueIn = () => {
    const expiry = options.getExpiry()
    return expiry ? expiry * 1000 - now() - OIDC_RENEW_BEFORE_EXPIRY_MS : null
  }
  const renew = () => {
    const expiry = options.getExpiry()
    renewing ||= options.refresh()
      .then(() => { failedForExpiry = undefined })
      .catch(() => { failedForExpiry = expiry ?? undefined })
      .finally(() => {
        renewing = undefined
        schedule()
      })
    return renewing
  }
  function schedule() {
    if (timer !== undefined) clearTimer(timer)
    timer = undefined
    const due = dueIn()
    if (due === null || failedForExpiry === options.getExpiry()) return
    timer = setTimer(() => {
      timer = undefined
      void renew()
    }, Math.max(MIN_DELAY_MS, due))
  }
  return {
    /** Re-plan after the token changed. */
    schedule,
    /** Background tabs throttle timers: renew at once if already due. */
    wake() {
      failedForExpiry = undefined
      const due = dueIn()
      if (due !== null && due <= 0) return renew()
      schedule()
    },
    stop() {
      if (timer !== undefined) clearTimer(timer)
      timer = undefined
    }
  }
}
