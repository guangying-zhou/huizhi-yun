const _useTenantContext = () => {
  const route = useRoute()
  const tenantCookie = useCookie<string | undefined>('hzy-current-tenant')
  const currentTenantCode = useState<string>('platform-current-tenant', () => {
    if (typeof route.query.tenantCode === 'string' && route.query.tenantCode.trim()) {
      return route.query.tenantCode.trim()
    }

    return tenantCookie.value || ''
  })

  function setCurrentTenantCode(value: string | null | undefined) {
    const normalized = String(value || '').trim()
    currentTenantCode.value = normalized
    tenantCookie.value = normalized || undefined
  }

  function clearCurrentTenantCode() {
    currentTenantCode.value = ''
    tenantCookie.value = undefined
  }

  watch(() => route.query.tenantCode, (value) => {
    if (typeof value !== 'string') {
      return
    }

    const normalized = value.trim()
    if (normalized && normalized !== currentTenantCode.value) {
      setCurrentTenantCode(normalized)
    }
  }, { immediate: true })

  return {
    currentTenantCode,
    setCurrentTenantCode,
    clearCurrentTenantCode
  }
}

export const useTenantContext = createSharedComposable(_useTenantContext)
