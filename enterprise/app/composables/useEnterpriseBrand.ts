export function useEnterpriseBrand() {
  const auth = useAuth()
  const scope = useState<string>('enterprise-cache-scope', () => '')
  const brand = useState<{ scope: string, name: string }>('enterprise-brand', () => ({ scope: '', name: '' }))
  const requested = useState<string>('enterprise-brand-requested', () => '')
  const name = computed(() => (brand.value.scope === scope.value && scope.value ? brand.value.name : '') || String(auth.tenant?.value || '').trim())
  let generation = 0
  watch(scope, async (current) => {
    if (!current) {
      generation++
      requested.value = ''
      brand.value = { scope: '', name: '' }
      return
    }
    if (requested.value === current) return
    const epoch = ++generation
    requested.value = current
    brand.value = { scope: current, name: '' }
    try {
      const response = await $fetch<{ code: number, data: { shortName: string, displayName: string } }>('/enterprise/api/org-brand', { cache: 'no-store', retry: 0 })
      if (epoch !== generation || current !== scope.value || response.code !== 0) return
      const value = [response.data?.shortName, response.data?.displayName].find(value => typeof value === 'string' && value.trim())
      brand.value = { scope: current, name: value?.trim() || '' }
    } catch {
      // A failed brand read must not interrupt work or expose diagnostic data.
    }
  }, { immediate: true })
  return { name }
}
