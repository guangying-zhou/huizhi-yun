/**
 * Composable for persisting year selection across pages using cookies.
 * The selected year is stored in a cookie and automatically synced across all pages.
 */
export function usePersistedYear() {
  const yearCookie = useCookie<number>('repoinsight-selected-year', {
    default: () => new Date().getFullYear(),
    maxAge: 60 * 60 * 24 * 365 // 1 year
  })

  return {
    year: yearCookie
  }
}
