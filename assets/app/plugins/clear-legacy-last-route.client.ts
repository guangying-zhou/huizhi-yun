export default defineNuxtPlugin(() => {
  const appCode = String(useRuntimeConfig().public.appCode || '').trim()
  if (appCode !== 'assets') return

  const savedPath = readLastRoute(appCode)
  if (savedPath === '/assets' || savedPath?.startsWith('/assets/')) {
    clearLastRoute(appCode)
  }
})
