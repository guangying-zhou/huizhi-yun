<script setup lang="ts">
import RemoteObjectSelectMenu from '../../../../foundation/app/components/RemoteObjectSelectMenu.vue'
import { useFinanceModule } from '../../../layer/useFinanceModule'
import { financeObjectOptions, financeChoiceError, financeChoicePage, type FinanceObjectKind, type FinanceObjectRow } from '../../utils/hostFinanceObjectChoices'

const props = defineProps<{ kind: FinanceObjectKind, enabled: boolean, contractCode?: string, accountValue?: 'id' | 'code', activeOnly?: boolean }>()
const model = defineModel<string>({ required: true })
const emit = defineEmits<{ select: [row: FinanceObjectRow] }>()
const { apiUrl, sessionScope } = useFinanceModule()
const page = ref(1)
const hasMore = ref(false)
const loading = ref(false)
const error = ref('')
const options = ref<ReturnType<typeof financeObjectOptions>>([])
const selected = ref<ReturnType<typeof financeObjectOptions>[number] | null>(null)
const { search, debounced, flush } = useDebouncedSearch()
const items = computed(() => selected.value && !options.value.some(item => item.value === selected.value?.value) ? [selected.value, ...options.value] : options.value)
const placeholder = computed(() => ({ 'customers': '搜索客户名称或编号', 'contracts': '搜索合同名称或编号', 'billing-schedules': '搜索当前页结算计划', 'bank-accounts': '搜索账户简称、名称或编号', 'legal-entities': '搜索法人主体名称或编号' })[props.kind])
let epoch = 0
async function load(append = false) {
  if (append && (loading.value || !hasMore.value)) return
  const current = ++epoch
  const requestedPage = append ? page.value + 1 : 1
  if (!append) {
    options.value = []
    page.value = 1
    hasMore.value = false
  }
  error.value = ''
  loading.value = false
  if (!props.enabled || (sessionScope && !sessionScope.value) || (props.kind === 'billing-schedules' && !props.contractCode)) return
  loading.value = true
  try {
    let url = ['bank-accounts', 'legal-entities'].includes(props.kind) ? apiUrl('/' + props.kind) : '/altoc/api/v1/' + props.kind
    if (props.kind === 'billing-schedules') {
      const contracts = financeChoicePage(await $fetch('/altoc/api/v1/contracts', { query: { page: 1, pageSize: 20, search: props.contractCode }, retry: 0 }))
      if (current !== epoch) return
      const contract = contracts.items.find(row => row.code === props.contractCode)
      if (!contract) throw new Error('Contract unavailable')
      url = `/altoc/api/v1/contracts/${contract.id}/billing-schedules`
    }
    const result = financeChoicePage(await $fetch(url, { query: { page: requestedPage, pageSize: 20, ...(props.kind === 'billing-schedules' ? {} : debounced.value ? { search: debounced.value } : {}) }, retry: 0 }))
    if (current !== epoch) return
    const next = financeObjectOptions(result.items.filter(row => !props.activeOnly || props.kind !== 'bank-accounts' || row.status === 'active'), props.kind, props.accountValue)
    options.value = append ? [...options.value, ...next.filter(option => !options.value.some(old => old.value === option.value))] : next
    page.value = requestedPage
    hasMore.value = result.items.length > 0 && result.items.length <= 20 && requestedPage * 20 < result.total
  } catch (failure) {
    if (current === epoch) error.value = financeChoiceError(failure)
  } finally {
    if (current === epoch) loading.value = false
  }
}
watch([() => props.enabled, () => props.kind, () => props.contractCode, () => sessionScope?.value, () => props.activeOnly, () => props.kind === 'billing-schedules' ? '' : debounced.value], () => void load(), { immediate: true })
watch(model, (value) => {
  const option = items.value.find(item => item.value === value)
  selected.value = option || null
  if (option) emit('select', option.row)
})
watch([() => sessionScope?.value, () => props.kind], () => {
  selected.value = null
  model.value = ''
  page.value = 1
})
watch(() => props.contractCode, () => {
  if (props.kind === 'billing-schedules') {
    model.value = ''
    selected.value = null
    page.value = 1
  }
})
onScopeDispose(() => {
  epoch++
})
</script>

<template>
  <div class="space-y-2">
    <RemoteObjectSelectMenu
      v-model="model"
      v-model:search-term="search"
      :items="items"
      :loading="loading"
      :error="error"
      :has-more="hasMore"
      :disabled="!enabled || (kind === 'billing-schedules' && !contractCode)"
      :ignore-filter="kind !== 'billing-schedules'"
      :placeholder="model || placeholder"
      @load-more="load(true)"
      @retry="load(options.length > 0)"
      @flush="flush"
    />
    <p
      v-if="kind === 'billing-schedules'"
      class="text-sm text-muted"
    >
      {{ contractCode ? '按所选合同滚动加载，可搜索已加载的计划；已到账或已取消计划不可选。' : '请先选择合同。' }}
    </p>
  </div>
</template>
