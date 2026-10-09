// Nuxt automatic chunk recovery is disabled for the immutable hzy0 candidate.
// A failed module never reloads the page until the user chooses the action.
export default defineNuxtPlugin((nuxtApp) => {
  if (useRuntimeConfig().public.manualRefresh !== true) return
  const toast = useToast()
  nuxtApp.hook('app:chunkError', () => {
    toast.add({ id: 'enterprise-new-version', title: '页面资源已更新', description: '点击刷新以加载当前版本。', color: 'warning', duration: 0, actions: [{ label: '刷新页面', onClick: () => window.location.reload() }] })
  })
})
