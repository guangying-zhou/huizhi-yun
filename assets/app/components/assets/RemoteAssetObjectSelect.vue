<script setup lang="ts">
import RemoteObjectSelectMenu from '../../../../foundation/app/components/RemoteObjectSelectMenu.vue'
import { useAssetsModule } from '../../../layer/useAssetsModule'

type Kind = 'products' | 'bases' | 'assets' | 'environments'
const props = withDefaults(defineProps<{ kind: Kind, enabled: boolean, excludeIds?: number[], productCandidates?: boolean }>(), { excludeIds: () => [], productCandidates: false })
const model = defineModel<number | undefined>({ required: true })
const selection = computed({ get: () => model.value ? String(model.value) : '', set: (value: string) => {
  model.value = value ? Number(value) : undefined
} })
const { moduleUrl, hosted } = useAssetsModule()
const scope = hosted ? useState<string>('enterprise-cache-scope', () => '') : ref('standalone')
const { search, debounced, flush } = useDebouncedSearch()
const options = ref<{ value: string, label: string }[]>([])
const selected = ref<{ value: string, label: string } | null>(null)
const items = computed(() => selected.value && !options.value.some(row => row.value === selected.value?.value) ? [selected.value, ...options.value] : options.value)
const loading = ref(false), error = ref(''), hasMore = ref(false), page = ref(1)
const paged = computed(() => hosted && props.kind === 'products')
const spec = computed(() => ({
  products: { path: '/api/v1/products', label: '产品', code: 'product_code', name: 'product_name' },
  bases: { path: hosted ? '/api/v1/products/link-candidates/bases' : '/api/v1/technology-bases', label: '技术底座', code: 'base_code', name: 'base_name' },
  assets: { path: hosted && props.productCandidates ? '/api/v1/products/link-candidates/assets' : '/api/v1/assets', label: '资产', code: 'asset_code', name: 'asset_name' },
  environments: { path: '/api/v1/environments', label: '环境', code: 'environment_code', name: 'environment_name' }
})[props.kind])
let epoch = 0
async function load(append = false) {
  if (append && (loading.value || !hasMore.value)) return
  const current = ++epoch, requestedPage = append ? page.value + 1 : 1
  if (!append) {
    options.value = []
    page.value = 1
    hasMore.value = false
  }
  error.value = ''
  loading.value = false
  if (!props.enabled || !scope.value) return
  loading.value = true
  try {
    // Existing candidate/full-list APIs reject query parameters: keep their
    // closed contract and search the authorized result locally in the popup.
    const response = await $fetch<{ code: number, data: { items: Record<string, unknown>[], total: number } }>(moduleUrl(spec.value.path), {
      ...(paged.value ? { query: { page: requestedPage, pageSize: 20, ...(debounced.value ? { search: debounced.value } : {}) } } : {}), retry: 0
    })
    if (current !== epoch) return
    const rows = response.data?.items, total = response.data?.total
    if (response.code !== 0 || !Array.isArray(rows) || !Number.isSafeInteger(total) || total < rows.length || rows.some(row => !Number.isSafeInteger(row.id) || Number(row.id) < 1)) throw Error('Invalid choices')
    const next = rows.filter(row => !props.excludeIds.includes(Number(row.id))).map(row => ({ value: String(row.id), label: `${String(row[spec.value.name] || row.name || spec.value.label)} · ${String(row[spec.value.code] || row.code || '')}` }))
    options.value = append ? [...options.value, ...next.filter(row => !options.value.some(old => old.value === row.value))] : next
    page.value = requestedPage
    hasMore.value = paged.value && rows.length > 0 && rows.length <= 20 && requestedPage * 20 < total
  } catch {
    if (current === epoch) error.value = '列表加载失败，请重试或确认查看权限'
  } finally { if (current === epoch) loading.value = false }
}
watch([() => props.enabled, () => props.kind, () => props.productCandidates, () => props.excludeIds.join(','), scope, () => paged.value ? debounced.value : ''], () => void load(), { immediate: true })
watch(selection, (value) => {
  selected.value = items.value.find(row => row.value === value) || null
})
watch([scope, () => props.kind], () => {
  selected.value = null
  model.value = undefined
})
onScopeDispose(() => {
  epoch++
})
</script>

<template>
  <RemoteObjectSelectMenu
    v-model="selection"
    v-model:search-term="search"
    :items="items"
    :loading="loading"
    :error="error"
    :has-more="hasMore"
    :ignore-filter="paged"
    :disabled="!enabled"
    :placeholder="`搜索${spec.label}名称或编号`"
    @load-more="load(true)"
    @retry="load(options.length > 0)"
    @flush="flush"
  />
</template>
