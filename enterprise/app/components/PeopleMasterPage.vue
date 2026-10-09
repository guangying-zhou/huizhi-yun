<script setup lang="ts">
import AltocBusinessObjectSelect from './AltocBusinessObjectSelect.vue'
import { apfServerFieldErrors } from '../utils/apfFormPresentation'
import type { APFChoiceRow } from '../utils/apfObjectChoices'
import type { TableColumn } from '@nuxt/ui'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'
import { formatMoney } from '../../../foundation/app/utils/format'

const props = defineProps<{ kind: 'positions' | 'ranks' | 'standard-costs' }>()
type Row = Record<string, string | number | null>
const spec = computed(() => props.kind === 'positions' ? { title: '岗位', resource: 'positions', code: 'position_code', name: 'position_name', breadcrumb: '人力资源 / 组织与岗位 / 岗位' } : props.kind === 'ranks' ? { title: '职级', resource: 'ranks', code: 'rank_code', name: 'rank_name', breadcrumb: '人力资源 / 组织与岗位 / 职级' } : { title: '职级工资设置', resource: 'standard_costs', code: 'rate_code', name: 'rate_name', breadcrumb: '人力资源 / 人员成本 / 职级工资设置' })
const { hasPermission, loaded, error: permissionError, loadPermissions } = usePermissions()
const canEdit = computed(() => loaded.value && !permissionError.value && hasPermission(spec.value.resource, 'admin'))
const canRead = computed(() => loaded.value && !permissionError.value && hasPermission(spec.value.resource, 'view'))
const { status: accessStatus } = useEnterpriseNavigationAccess()
const scope = useState<string>('enterprise-cache-scope', () => '')
const pending = ref(false)
const error = ref('')
const rows = ref<Row[]>([])
const total = ref(0)
const page = ref(1)
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const editing = ref<Row | null>(null)
const open = ref(false)
const saving = ref(false)
const formError = ref('')
const fieldErrors = ref<Record<string, string>>({})
const draft = reactive<Record<string, string | number>>({})
const { confirm } = useConfirm()
const toast = useToast()
const intent = createConsoleMutationIntent('people-master')
const base = computed(() => `/enterprise/api/apf/people/${props.kind}`)
let epoch = 0
let financeEpoch = 0
const fields = computed(() => props.kind === 'positions'
  ? [
      ['position_code', '岗位编码', 'required'], ['position_name', '岗位名称', 'required'], ['job_family', '岗位序列', ''], ['description', '说明', ''], ['enabled', '状态', 'number'], ['sort_order', '排序', 'number']
    ]
  : props.kind === 'ranks'
    ? [
        ['rank_code', '职级编码', 'required'], ['rank_name', '职级名称', 'required'], ['rank_series', '职级类型', 'required'], ['rank_level', '职级序号', 'number'], ['description', '说明', ''], ['enabled', '状态', 'number'], ['sort_order', '排序', 'number']
      ]
    : [
        ['rate_code', '设置编码', 'required'], ['rate_name', '设置名称', 'required'], ['rank_code', '职级编码', 'required'], ['rank_series', '职级类型', 'required'], ['rank_level', '职级序号', 'number'], ['position_code', '适用岗位编码（留空为不限）', ''], ['employment_type', '用工类型（留空为不限）', ''], ['cost_center_code', '成本中心编码（留空为不限）', ''],
        ['rank_salary', '职级工资', 'money'], ['performance_salary_min', '绩效工资下限', 'money'], ['performance_salary_max', '绩效工资上限', 'money'], ['currency', '币种', 'required'], ['effective_from', '生效日期', 'date-required'], ['effective_to', '截止日期', 'date'], ['enabled', '状态', 'number'], ['sort_order', '排序', 'number'], ['remarks', '备注', '']
      ])
const columns = computed<TableColumn<Row>[]>(() => [
  { accessorKey: spec.value.code, header: '编码' }, { accessorKey: spec.value.name, header: '名称' },
  ...props.kind !== 'positions' ? [{ accessorKey: 'rank_series', header: '类型' }, { accessorKey: 'rank_level', header: '序号' }] : [],
  ...props.kind === 'standard-costs' ? ['rank_salary', 'performance_salary_min', 'performance_salary_max'].map(k => ({ accessorKey: k, header: k === 'rank_salary' ? '职级工资' : k.endsWith('min') ? '绩效下限' : '绩效上限', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } })) : [],
  { accessorKey: 'enabled', header: '状态' }, { id: 'actions', header: '操作' }
])
function selectedRank(row: APFChoiceRow) {
  draft.rank_series = String(row.rank_series)
  draft.rank_level = Number(row.rank_level)
}
function options(key: string) {
  if (key === 'enabled')
    return [{ label: '启用', value: 1 }, { label: '停用', value: 0 }]
  if (key === 'rank_series')
    return [{ label: '管理（M）', value: 'M' }, { label: '专业（P）', value: 'P' }]
  if (key === 'employment_type')
    return [{ label: '不限', value: '__any__' }, { label: '全职', value: 'full_time' }, { label: '兼职', value: 'part_time' }, { label: '外包', value: 'outsourced' }, { label: '实习', value: 'intern' }, { label: '代理', value: 'agent' }]
  return []
}
async function load() {
  const current = ++epoch
  if (!canRead.value || accessStatus.value !== 'ready' || !scope.value) {
    rows.value = []
    total.value = 0
    return
  }
  pending.value = true
  error.value = ''
  try {
    const url = props.kind === 'positions' ? base.value + '/list' : base.value
    const response = await $fetch<{ code: number, data: { data: Row[], items?: Row[], total: number } }>(url, { query: { page: page.value, pageSize: 20, search: debounced.value } })
    if (current !== epoch)
      return
    rows.value = response.data.data || response.data.items || []
    total.value = response.data.total
  } catch {
    if (current === epoch)
      error.value = '列表加载失败，请重试'
  } finally {
    if (current === epoch)
      pending.value = false
  }
}
function edit(row: Row | null) {
  editing.value = row
  for (const key of Object.keys(draft))
    Reflect.deleteProperty(draft, key)
  for (const [key, , type] of fields.value)
    draft[key!] = type === 'number' && row?.[key!] != null ? Number(row[key!]) : (key === 'employment_type' && !row?.[key!] ? '__any__' : row?.[key!]) ?? (key === 'enabled' ? 1 : type === 'number' ? 0 : type === 'money' ? '0.00' : key === 'rank_series' ? 'P' : key === 'currency' ? 'CNY' : '')
  fieldErrors.value = {}
  formError.value = ''
  open.value = true
}
function safeError(e: unknown) {
  const status = Number((e as { statusCode?: number, status?: number }).statusCode || (e as { status?: number }).status)
  return status === 409 ? '数据版本已变化、编码重复或仍被引用，请刷新核对后重试' : status === 400 ? '请检查必填字段、金额和生效日期' : status === 403 ? '当前无权执行此操作' : '操作未完成，请重试同一意图'
}
async function save() {
  if (!canEdit.value || saving.value)
    return
  fieldErrors.value = {}
  for (const [key, label, type] of fields.value) {
    if ((type?.includes('required') || type === 'money') && !String(draft[key!] ?? '').trim())
      fieldErrors.value[key!] = `请填写${label}`
    if (type === 'money' && !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(String(draft[key!])))
      fieldErrors.value[key!] = '请输入非负金额，最多两位小数'
  }
  if (Object.keys(fieldErrors.value).length)
    return
  const payload = { ...draft }
  if (payload.employment_type === '__any__')
    payload.employment_type = ''
  for (const [key, , type] of fields.value)
    if (type === 'number')
      payload[key!] = Number(payload[key!] || 0)
  const body = { ...payload, ...editing.value ? { expectedVersion: Number(editing.value.row_version) } : {} }
  saving.value = true
  try {
    const url = base.value + (editing.value ? `/${editing.value.id}` : '')
    const done = await intent.submit({ method: editing.value ? 'PATCH' : 'POST', path: url, body }, (request, key) => $fetch(request.path, { method: request.method, body: request.body, headers: { 'Idempotency-Key': key } }))
    if (!done)
      return
    open.value = false
    await load()
    toast.add({ title: '已保存', color: 'success' })
  } catch (e) {
    fieldErrors.value = apfServerFieldErrors(e, fields.value.map(f => f[0]!))
    formError.value = safeError(e)
  } finally {
    saving.value = false
  }
}
async function remove(row: Row) {
  if (!canEdit.value || !await confirm({ title: `删除${spec.value.title}`, message: `将删除“${row[spec.value.name]}”；存在员工、任职或成本引用时无法删除。`, tone: 'danger' }))
    return
  try {
    const body = { expectedVersion: Number(row.row_version) }
    const url = `${base.value}/${row.id}`
    const done = await intent.submit({ method: 'DELETE', path: url, body }, (request, key) => $fetch(request.path, { method: request.method, body: request.body, headers: { 'Idempotency-Key': key } }))
    if (!done)
      return
    await load()
  } catch (e) {
    toast.add({ title: safeError(e), color: 'error' })
  }
}
const financeState = ref<'idle' | 'ready' | 'forbidden' | 'error'>('idle')
const financeParameters = ref<Row[]>([])
async function loadFinanceReference() {
  const current = ++financeEpoch
  if (props.kind !== 'standard-costs' || !canRead.value || !scope.value || accessStatus.value !== 'ready')
    return
  try {
    const response = await $fetch<{ data: { data: Row[] } }>('/finance/api/v1/settings/people-cost-parameters', { query: { page: 1, pageSize: 20 } })
    if (current !== financeEpoch)
      return
    financeParameters.value = response.data.data
    financeState.value = 'ready'
  } catch (e) {
    if (current !== financeEpoch)
      return
    financeState.value = Number((e as { statusCode?: number }).statusCode) === 403 ? 'forbidden' : 'error'
  }
}
onMounted(() => {
  void loadPermissions()
})
watch([page, debounced, loaded, canRead, scope, accessStatus], () => {
  void load()
}, { immediate: true })
watch([canRead, scope, accessStatus], () => {
  financeParameters.value = []
  financeState.value = 'idle'
  void loadFinanceReference()
})
onScopeDispose(() => {
  epoch++
  financeEpoch++
})
</script>

<template>
  <UDashboardPanel>
    <template #body>
      <div class="space-y-4 p-4 min-w-0">
        <ContentPageHeader
          :hosted="true"
          :title="spec.title"
          :description="props.kind === 'standard-costs' ? '按有效日期维护职级工资和绩效范围，不修改历史成本快照' : '维护组织主数据；被业务引用的字典不可删除'"
          :breadcrumb="spec.breadcrumb"
        >
          <template #actions>
            <UButton
              v-if="canEdit"
              @click="edit(null)"
            >
              新建{{ spec.title }}
            </UButton>
          </template>
        </ContentPageHeader>
        <UAlert
          v-if="permissionError"
          color="error"
          title="权限信息加载失败"
        />
        <UAlert
          v-if="props.kind !== 'positions'"
          color="info"
          title="序列数量由 Console 系统参数维护"
        />
        <UAlert
          v-if="error"
          color="error"
          :title="error"
        />
        <UInput
          v-model="search"
          placeholder="搜索编码或名称"
          icon="i-lucide-search"
          class="w-full sm:max-w-xs"
          @keyup.enter="flush"
        />
        <div class="overflow-x-auto">
          <UTable
            :data="rows"
            :columns="columns"
            :loading="pending"
          >
            <template #empty>
              <CommonEmptyState
                :title="canRead ? '暂无记录' : '无权查看'"
                :description="canEdit ? '可通过页头新建按钮新增记录' : '没有可显示的数据'"
              />
            </template>
            <template #rank_series-cell="{ row }">
              {{ row.original.rank_series === 'M' ? '管理' : '专业' }}
            </template>
            <template #enabled-cell="{ row }">
              <UBadge
                :color="Number(row.original.enabled) ? 'success' : 'neutral'"
                variant="subtle"
              >
                {{ Number(row.original.enabled) ? '启用' : '停用' }}
              </UBadge>
            </template>
            <template #rank_salary-cell="{ row }">
              {{ formatMoney(row.original.rank_salary) }}
            </template>
            <template #performance_salary_min-cell="{ row }">
              {{ formatMoney(row.original.performance_salary_min) }}
            </template>
            <template #performance_salary_max-cell="{ row }">
              {{ formatMoney(row.original.performance_salary_max) }}
            </template>
            <template #actions-cell="{ row }">
              <div class="flex gap-2">
                <UButton
                  v-if="canEdit"
                  color="neutral"
                  variant="outline"
                  size="xs"
                  @click="edit(row.original)"
                >
                  编辑
                </UButton><UButton
                  v-if="canEdit && props.kind !== 'standard-costs'"
                  color="error"
                  variant="ghost"
                  size="xs"
                  @click="remove(row.original)"
                >
                  删除
                </UButton>
              </div>
            </template>
          </UTable>
        </div>
        <div class="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
            v-model:page="page"
            :total="total"
            :items-per-page="20"
          />
        </div>
        <UCard v-if="props.kind === 'standard-costs'">
          <template #header>
            Finance 成本参数参考
          </template><p v-if="financeState === 'forbidden'">
            无权查看 Finance 成本参数
          </p><p v-else-if="financeState === 'error'">
            Finance 成本参数暂不可用
          </p><p v-else-if="!financeParameters.length">
            暂无可用参数
          </p><ul
            v-else
            class="text-sm space-y-1"
          >
            <li
              v-for="row in financeParameters"
              :key="String(row.code)"
            >
              {{ row.name }} · {{ row.effective_from }} · 基本工资 {{ formatMoney(row.base_salary) }}
            </li>
          </ul>
        </UCard>
        <USlideover
          v-model:open="open"
          :title="`${editing ? '编辑' : '新建'}${spec.title}`"
          description="按分组填写必需字段；保存前检查版本与授权"
          :ui="{ content: 'sm:max-w-3xl' }"
        >
          <template #body>
            <form
              id="people-master-form"
              class="space-y-5"
              @submit.prevent="save"
            >
              <UAlert
                v-if="formError"
                color="error"
                :title="formError"
              /><section class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <h3 class="sm:col-span-2 font-medium">
                  基本信息与适用范围
                </h3><UFormField
                  v-for="[key, label, type] in fields.filter(f => !['money', 'date', 'date-required'].includes(f[2]!))"
                  :key="key"
                  :label="label"
                  :required="type?.includes('required') || key === 'rank_level'"
                  :error="fieldErrors[key!]"
                >
                  <AltocBusinessObjectSelect
                    v-if="kind === 'standard-costs' && key === 'rank_code'"
                    v-model="draft[key!] as string"
                    kind="ranks"
                    :enabled="open && canEdit"
                    @select="selectedRank"
                  />
                  <AltocBusinessObjectSelect
                    v-else-if="kind === 'standard-costs' && key === 'position_code'"
                    v-model="draft[key!] as string"
                    kind="positions"
                    :enabled="open && canEdit"
                  />
                  <USelect
                    v-else-if="options(key!).length"
                    v-model="draft[key!]"
                    :items="options(key!)"
                    :disabled="kind === 'standard-costs' && key === 'rank_series'"
                    class="w-full"
                  /><UInput
                    v-else
                    v-model="draft[key!]"
                    :type="type === 'number' ? 'number' : 'text'"
                    :readonly="kind === 'standard-costs' && key === 'rank_level'"
                    class="w-full"
                  />
                </UFormField>
              </section><section
                v-if="props.kind === 'standard-costs'"
                class="grid grid-cols-1 sm:grid-cols-2 gap-4"
              >
                <h3 class="sm:col-span-2 font-medium">
                  工资范围与有效日期
                </h3><UFormField
                  v-for="[key, label, type] in fields.filter(f => ['money', 'date', 'date-required'].includes(f[2]!))"
                  :key="key"
                  :label="label"
                  :required="type !== 'date'"
                  :error="fieldErrors[key!]"
                >
                  <UInput
                    v-model="draft[key!]"
                    :type="type?.startsWith('date') ? 'date' : 'text'"
                    class="w-full"
                  />
                </UFormField>
              </section>
            </form>
          </template><template #footer>
            <div class="flex gap-2 justify-end w-full">
              <UButton
                color="neutral"
                variant="outline"
                @click="open = false"
              >
                取消
              </UButton><UButton
                type="submit"
                form="people-master-form"
                :loading="saving"
                :disabled="!canEdit"
              >
                保存
              </UButton>
            </div>
          </template>
        </USlideover>
      </div>
    </template>
  </UDashboardPanel>
</template>
