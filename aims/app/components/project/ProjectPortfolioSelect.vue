<script setup lang="ts">
import RemoteObjectSelectMenu from '@hzy/foundation/app/components/RemoteObjectSelectMenu.vue'
import { useAimsModule } from '../../../layer/useAimsModule'

const model = defineModel<string>({
  default: '' })
const props = withDefaults(defineProps<{
  disabled?: boolean
  all?: boolean }>(), {
  disabled: false, all: false })
const {
  moduleUrl } = useAimsModule()
const search = ref(''), debounced = ref(''), loading = ref(false), error = ref(false), hasMore = ref(false)
const items = ref<{
  value: string
  label: string }[]>([])
let page = 0, generation = 0
const {
  search: text, debounced: settled, flush } = useDebouncedSearch()
watch(search, (value) => {
  text.value = value
})
watch(settled, (value) => {
  debounced.value = value
  void load(true)
})
const options = computed(() => [{
  value: 'none', label: props.all ? '全部项目集' : '未分组' }, ...(props.all
  ? [{
      value: '0', label: '未分组' }]
  : []), ...(model.value && model.value !== '0' && !items.value.some(item => item.value === model.value) ? [{ value: model.value, label: `项目集 #${model.value}` }] : []), ...items.value])
const value = computed({
  get: () => model.value || 'none', set: (value: string) => {
    model.value = value === 'none' ? '' : value
  } })
const scope = useState<string>('enterprise-cache-scope', () => '')
async function load(reset = false) {
  if (!reset && (loading.value || !hasMore.value)) return
  if (reset) {
    generation++
    page = 0
    items.value = []
  }
  const current = generation, requestedPage = page + 1
  loading.value = true
  error.value = false
  try {
    const res = await $fetch<{
      code: number
      data: {
        items: {
          id: number
          name: string
          code: string }[]
        total: number } }>(moduleUrl('/api/v1/portfolios'), {
      query: {
        page: requestedPage, pageSize: 20, ...(debounced.value
          ? {
              search: debounced.value }
          : {}) } })
    if (current !== generation) return
    if (res.code !== 0 || !Array.isArray(res.data.items) || !Number.isSafeInteger(res.data.total)) throw Error('项目集列表无效')
    const seen = new Set(items.value.map(row => row.value))
    items.value.push(...res.data.items.filter(row => !seen.has(String(row.id))).map(row => ({
      value: String(row.id), label: `${row.name} · ${row.code}` })))
    page = requestedPage
    hasMore.value = res.data.items.length > 0 && page * 20 < res.data.total
  } catch {
    if (current === generation) error.value = true
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(scope, () => {
  model.value = ''
  void load(true)
})
onMounted(() => void load(true))
</script>

<template>
  <RemoteObjectSelectMenu
    v-model="value"
    v-model:search-term="search"
    :items="options"
    :loading="loading"
    :error="error ? '项目集暂不可用，请重试' : ''"
    :has-more="hasMore"
    :disabled="disabled"
    placeholder="选择项目集"
    @load-more="load()"
    @retry="load(page === 0)"
    @flush="flush"
  />
</template>
