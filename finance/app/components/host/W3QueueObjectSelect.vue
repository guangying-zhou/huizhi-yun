<script setup lang="ts">
import FinanceBusinessObjectSelect from './FinanceBusinessObjectSelect.vue'
import RemoteObjectSelectMenu from '../../../../foundation/app/components/RemoteObjectSelectMenu.vue'

const props = defineProps<{ kind: 'customers' | 'contacts' | 'bank-accounts', enabled: boolean, customerId?: string }>()
const model = defineModel<string>({ required: true })
const page = ref(1)
const hasMore = ref(false)
const selected = ref<{ label: string, value: string } | null>(null)
const items = ref<{ label: string, value: string }[]>([])
const loading = ref(false)
const error = ref('')
const { search, debounced, flush } = useDebouncedSearch()
const scope = useState<string>('enterprise-cache-scope', () => '')
const choices = computed(() => selected.value && !items.value.some(item => item.value === selected.value?.value) ? [selected.value, ...items.value] : items.value)
watch(model, (value) => {
  selected.value = choices.value.find(item => item.value === value) || null
})
let generation = 0
async function load(append = false) {
  if (append && (loading.value || !hasMore.value)) return
  const requestedPage = append ? page.value + 1 : 1
  const token = ++generation
  loading.value = false
  if (!append) {
    items.value = []
    page.value = 1
    hasMore.value = false
  }
  if (props.kind === 'bank-accounts' || !props.enabled || !scope.value || (props.kind === 'contacts' && !props.customerId)) return
  loading.value = true
  error.value = ''
  try {
    const path = props.kind === 'contacts' ? `/altoc/api/v1/customers/${encodeURIComponent(props.customerId!)}` : '/altoc/api/v1/customers'
    const response = await $fetch<{ data: Record<string, unknown>[] | { contacts?: Record<string, unknown>[], items?: Record<string, unknown>[], total?: number }, total?: number }>(path, { query: props.kind === 'contacts' ? {} : { page: requestedPage, pageSize: 20, ...(debounced.value.trim() ? { search: debounced.value.trim() } : {}) }, retry: 0 })
    if (token !== generation) return
    const rows = props.kind === 'contacts' ? (response.data as { contacts?: Record<string, unknown>[] })?.contacts : Array.isArray(response.data) ? response.data : response.data?.items
    if (!Array.isArray(rows)) throw Error('Invalid choices')
    const next = rows.map(row => ({ value: String(props.kind === 'customers' ? row.id : row.code), label: `${String(row.name || row.account_name || row.code)} · ${String(row.code || '')}` }))
    items.value = append ? [...items.value, ...next.filter(item => !items.value.some(old => old.value === item.value))] : next
    page.value = requestedPage
    const total = props.kind === 'contacts' ? rows.length : Number(response.total ?? (response.data as { total?: number })?.total ?? rows.length)
    hasMore.value = props.kind !== 'contacts' && rows.length > 0 && rows.length <= 20 && requestedPage * 20 < total
  } catch {
    if (token === generation) error.value = '可选对象加载失败，请重试或确认查看权限'
  } finally {
    if (token === generation) loading.value = false
  }
}
watch([() => props.enabled, () => props.kind, () => props.customerId, scope, () => props.kind === 'contacts' ? '' : debounced.value], () => void load(), { immediate: true })
watch([scope, () => props.customerId, () => props.kind], () => {
  selected.value = null
  model.value = ''
  page.value = 1
})
onScopeDispose(() => {
  generation++
})
</script>

<template>
  <FinanceBusinessObjectSelect
    v-if="kind === 'bank-accounts'"
    v-model="model"
    kind="bank-accounts"
    account-value="code"
    :enabled="enabled"
    active-only
  />
  <div
    v-else
    class="space-y-2"
  >
    <RemoteObjectSelectMenu
      v-model="model"
      v-model:search-term="search"
      :items="choices"
      :ignore-filter="kind !== 'contacts'"
      :loading="loading"
      :error="error"
      :has-more="hasMore"
      :disabled="!enabled || (kind === 'contacts' && !customerId)"
      @load-more="load(true)"
      @retry="load(items.length > 0)"
      @flush="flush"
    />
  </div>
</template>
