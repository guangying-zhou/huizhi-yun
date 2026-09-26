interface ViewerDirectoryUser {
  uid: string
  realName?: string | null
  mobileTail4?: string | null
}

interface ViewerApiResponse<T> {
  code: number
  data: T
}

export function useViewerWatermark() {
  const { user, tenant, userRealname, userMobileTail } = useAuth()
  const requestFetch = useRequestFetch()
  const { resolveCurrentAppPath } = useAppUrls()
  const appCode = String(useRuntimeConfig().public.appCode || '')
  const directoryMePath = appCode === 'enterprise' ? '/api/directory/me' : resolveCurrentAppPath('/api/directory/me')
  const viewerKey = computed(() => JSON.stringify([tenant.value, user.value]))

  const { data: accountUser } = useAsyncData<(ViewerDirectoryUser & { viewerKey: string }) | null>(
    computed(() => `viewer-watermark:${viewerKey.value}`),
    async () => {
      const uid = String(user.value || '').trim()
      const requestViewerKey = viewerKey.value
      if (!uid) return null

      try {
        // The self profile carries only the phone suffix. Shared directory
        // search deliberately excludes phone data and cannot supply a watermark.
        const response = await requestFetch<ViewerApiResponse<ViewerDirectoryUser>>(
          directoryMePath
        )
        if (requestViewerKey !== viewerKey.value || response.code !== 0 || response.data?.uid !== uid) return null
        return { ...response.data, viewerKey: requestViewerKey }
      } catch {
        return null
      }
    },
    { default: () => null }
  )

  const watermarkText = computed(() => {
    const uid = String(user.value || '').trim()
    if (!uid) return ''
    const profile = accountUser.value?.uid === uid && accountUser.value.viewerKey === viewerKey.value ? accountUser.value : null
    const viewerName = String(profile?.realName || userRealname.value || uid).trim()
    const tail = String(profile ? profile.mobileTail4 || '' : userMobileTail.value || '').trim()
    const mobileTail = /^\d{4}$/.test(tail) ? tail : '****'
    return `${viewerName} ${mobileTail}`
  })

  return {
    watermarkText,
    accountUser
  }
}
