type BundleRefreshResponse = {
  code: number
  message?: string
  data?: {
    refreshed?: boolean
    refreshRequired?: boolean
    currentBundleVersion?: string | null
    latestBundleVersion?: string | null
    requestedBundleVersion?: string | null
    previousBundleVersion?: string | null
    bundleVersion?: string | null
    bundleHash?: string | null
  }
}

type BundleRefreshState = {
  checked: boolean
  pending: boolean
  refreshRequired: boolean
  refreshed: boolean
  bundleVersion: string | null
  bundleHash: string | null
  latestBundleVersion: string | null
  lastCheckedAt: string | null
  error: string | null
}

export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.server || !to.path.startsWith('/admin')) {
    return
  }

  const state = useState<BundleRefreshState>('console-admin-bundle-refresh', () => ({
    checked: false,
    pending: false,
    refreshRequired: false,
    refreshed: false,
    bundleVersion: null,
    bundleHash: null,
    latestBundleVersion: null,
    lastCheckedAt: null,
    error: null
  }))

  if (state.value.checked || state.value.pending) {
    return
  }

  state.value.pending = true
  void $fetch<BundleRefreshResponse>('/api/activation/bundle-refresh', {
    method: 'POST',
    cache: 'no-store'
  })
    .then(async (response) => {
      const data = response.data
      state.value.refreshRequired = Boolean(data?.refreshRequired)
      state.value.refreshed = Boolean(data?.refreshed)
      state.value.bundleVersion = data?.bundleVersion || data?.currentBundleVersion || state.value.bundleVersion
      state.value.bundleHash = data?.bundleHash || state.value.bundleHash
      state.value.latestBundleVersion = data?.latestBundleVersion || data?.requestedBundleVersion || data?.bundleVersion || state.value.latestBundleVersion
      state.value.error = response.code === 0 ? null : response.message || 'bundle refresh check failed'

      if (!data?.refreshed) {
        return
      }

      const { clearCache, loadPermissions } = usePermissions()
      clearCache()
      await loadPermissions()
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      state.value.error = message
      console.warn(`[console] admin bundle refresh check failed: ${message}`)
    })
    .finally(() => {
      state.value.checked = true
      state.value.pending = false
      state.value.lastCheckedAt = new Date().toISOString()
    })
})
