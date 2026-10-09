<script setup lang="ts">
import { apfObjectSpecs, apfChoicePage, apfChoiceOptions, type APFObjectKind, type APFChoiceRow } from '../utils/apfObjectChoices'
import RemoteObjectSelectMenu from '../../../foundation/app/components/RemoteObjectSelectMenu.vue'

const props = defineProps<{ kind: APFObjectKind, enabled: boolean, parentId?: string, searchHint?: string, customerId?: string, employeeUid?: string }>()
const model = defineModel<string>({ required: true })
type Option = ReturnType<typeof apfChoiceOptions>[number]
const emit = defineEmits<{ select: [row: APFChoiceRow] }>()
const spec = computed(() => apfObjectSpecs[props.kind])
const { loaded, error: permissionError, hasPermission } = usePermissions()
const { status: accessStatus } = useEnterpriseNavigationAccess()
const scope = useState<string>('enterprise-cache-scope', () => '')
const allowed = computed(() => loaded.value && !permissionError.value && (!spec.value.resource || hasPermission(spec.value.resource, 'view')))
const page = ref(1)
const hasMore = ref(false)
const options = ref<Option[]>([])
const selected = ref<Option | null>(null)
const loading = ref(false)
const error = ref('')
const { search, debounced, flush } = useDebouncedSearch()
const items = computed(() => selected.value && !options.value.some(option => option.value === selected.value?.value) ? [selected.value, ...options.value] : options.value)
let epoch = 0
async function load(append = false) {
  if (append && (loading.value || !hasMore.value)) return
  const requestedPage = append ? page.value + 1 : 1
  const current = ++epoch
  if (!append) {
    options.value = []
    page.value = 1
    hasMore.value = false
  }
  loading.value = false
  error.value = ''
  if (!props.enabled || !allowed.value || !scope.value || accessStatus.value !== 'ready' || (['contacts', 'contract-lines'].includes(props.kind) && !props.parentId)) return
  loading.value = true
  try {
    const path = props.kind === 'contacts' ? `${spec.value.path}/${encodeURIComponent(props.parentId!)}` : props.kind === 'contract-lines' ? `${spec.value.path}/${encodeURIComponent(props.parentId!)}/lines` : spec.value.path
    const response = await $fetch(path, { query: props.kind === 'contacts' ? {} : { page: requestedPage, pageSize: 20, ...props.kind === 'contract-lines' || !(debounced.value || props.searchHint) ? {} : { search: debounced.value || props.searchHint } }, retry: 0 })
    const result = apfChoicePage(response, props.kind)
    if (current !== epoch) return
    const next = apfChoiceOptions(result.rows.filter(row => (!['positions', 'ranks'].includes(props.kind) || Number(row.enabled) === 1) && (!props.customerId || String(row.customer_id) === props.customerId) && (!props.employeeUid || (String(row.employee_uid) === props.employeeUid && row.change_type === 'leave' && ['approved', 'none'].includes(String(row.approval_status))))), props.kind)
    options.value = append ? [...options.value, ...next.filter(option => !options.value.some(old => old.value === option.value))] : next
    page.value = requestedPage
    hasMore.value = props.kind !== 'contacts' && result.rows.length > 0 && result.rows.length <= 20 && requestedPage * 20 < result.total
  } catch {
    if (current === epoch) error.value = '列表加载失败，请重试或确认查看权限'
  } finally {
    if (current === epoch) loading.value = false
  }
}
watch([() => props.enabled, () => props.kind, () => props.parentId, () => props.searchHint, () => props.customerId, () => props.employeeUid, allowed, scope, accessStatus, debounced], () => void load(), { immediate: true })
watch(model, (value) => {
  selected.value = items.value.find(item => item.value === value) || null
  if (selected.value) emit('select', selected.value.row)
})
watch([scope, () => props.kind, () => props.parentId, () => props.customerId, () => props.employeeUid], () => {
  selected.value = null
  model.value = ''
  page.value = 1
})
onScopeDispose(() => {
  epoch++
})
</script>

<template>
  <div class="space-y-2">
    <p
      v-if="permissionError"
      class="text-sm text-error"
    >
      查看权限加载失败，请刷新后重试
    </p>
    <p
      v-else-if="!loaded"
      class="text-sm text-muted"
    >
      正在加载查看权限
    </p>
    <p
      v-else-if="!allowed"
      class="text-sm text-muted"
    >
      没有查看此业务对象的权限
    </p>
    <template v-else>
      <RemoteObjectSelectMenu
        v-model="model"
        v-model:search-term="search"
        :items="items"
        :loading="loading"
        :error="error"
        :has-more="hasMore"
        :disabled="!enabled || (['contacts', 'contract-lines'].includes(kind) && !parentId)"
        :ignore-filter="!['contacts', 'contract-lines'].includes(kind)"
        :placeholder="model ? '当前已选记录（可搜索更换）' : `搜索${spec.label}名称或编号`"
        @load-more="load(true)"
        @retry="load(options.length > 0)"
        @flush="flush"
      />
      <UButton
        v-if="model"
        variant="link"
        color="neutral"
        :disabled="!enabled"
        @click="model = ''"
      >
        清除选择
      </UButton>
    </template>
  </div>
</template>
