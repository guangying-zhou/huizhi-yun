export function usePageTitle(title: string) {
  const config = useRuntimeConfig()
  const appName = String(config.public.appDisplayName || '汇智云平台')

  useHead({
    title: title ? `${title} - ${appName}` : appName
  })
}
