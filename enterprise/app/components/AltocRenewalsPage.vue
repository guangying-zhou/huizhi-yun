<script setup lang="ts">
import APFDepartmentSelect from './APFDepartmentSelect.vue'
import AltocBusinessObjectSelect from './AltocBusinessObjectSelect.vue'
import { apfServerFieldErrors, apfEnumLabel } from '../utils/apfFormPresentation'
import type { TableColumn } from '@nuxt/ui'
import { formatMoney } from '../../../foundation/app/utils/format'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'
import { renewalFields } from '../../shared/altoc-renewals'

const fieldErrors = ref<Record<string, string>>({})

const props = defineProps<{ mode: 'list' | 'new' | 'detail' }>()
type Row = Record<string, string | number | null>
const route = useRoute()
const id = computed(() => String(route.params.renewalId || ''))
const { user } = useAuth()
const { loaded, error: permissionError, loadPermissions, hasPermission } = usePermissions()
onMounted(() => void loadPermissions())
const canRead = computed(() => loaded.value && !permissionError.value && hasPermission('renewal_opportunity', 'view'))
const canEdit = computed(() => loaded.value && !permissionError.value && hasPermission('renewal_opportunity', 'edit'))
const { status: accessStatus } = useEnterpriseNavigationAccess()
const cache = useState<string>('enterprise-cache-scope', () => '')
const ready = computed(() => canRead.value && accessStatus.value === 'ready' && Boolean(cache.value))
const page = ref(1)
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const rows = ref<Row[]>([])
const record = ref<Row | null>(null)
const total = ref(0)
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const editOpen = ref(false)
const api = computed(() => `/altoc/api/v1/renewals${props.mode === 'detail' ? `/${id.value}` : ''}`)
const draft = reactive<Record<string, string>>({ name: '', customer_id: '', contract_id: '', renewal_type: 'maintenance', stage: 'identified', status: 'open', owner_uid: '', owner_dept_code: '', expected_amount: '', expected_sign_date: '', risk_level: '', reason: '', next_action: '', next_action_due_date: '' })
watch(() => user.value, (uid) => {
  if (props.mode === 'new' && !draft.owner_uid) draft.owner_uid = String(uid || '')
}, { immediate: true })
const owner = computed({ get: () => draft.owner_uid ? [draft.owner_uid || ''] : [], set: (uids: string[]) => {
  draft.owner_uid = uids[0] || ''
} })
const labels: Record<string, string> = { maintenance: '维保续约', upsell: '增购', cross_sell: '交叉销售', identified: '已识别', contacted: '已联系', proposal: '方案中', negotiation: '谈判中', closed: '已收口', open: '进行中', won: '已达成', lost: '未达成', cancelled: '已取消', low: '低', medium: '中', high: '高' }
const options = (values: string[]) => values.map(value => ({ value, label: labels[value] || apfEnumLabel(value) }))
const uids = computed(() => [...rows.value.map(row => String(row.owner_uid || '')), String(record.value?.owner_uid || ''), String(draft.owner_uid || '')])
const { userName, directoryError } = useAltocDirectoryLabels(uids)
const columns: TableColumn<Row>[] = [{ accessorKey: 'code', header: '续约编号' }, { accessorKey: 'name', header: '续约记录' }, { accessorKey: 'owner_uid', header: '负责人' }, { accessorKey: 'status', header: '状态' }, { accessorKey: 'expected_amount', header: '预计金额', meta: { class: { th: 'text-right', td: 'text-right' } } }, { accessorKey: 'expected_sign_date', header: '预计签订日期' }]
const money = (v: unknown) => v === null || v === '' || v === undefined ? '未填写' : formatMoney(String(v), { currency: 'CNY' })
let epoch = 0
async function load() {
  const n = ++epoch
  if (!ready.value || props.mode === 'new') {
    rows.value = []
    record.value = null
    return
  }
  loading.value = true
  message.value = ''
  try {
    const result = await $fetch<{ data: Row & { items: Row[], total: number } }>(api.value, { query: props.mode === 'list' ? { page: page.value, pageSize: 20, search: debounced.value } : {} })
    if (n !== epoch) return
    if (props.mode === 'list') {
      rows.value = result.data.items
      total.value = result.data.total
    } else record.value = result.data
  } catch {
    if (n === epoch) message.value = '续约记录读取失败，请稍后重试'
  } finally {
    if (n === epoch) loading.value = false
  }
}
watch([ready, id, page, debounced, cache], () => void load(), { immediate: true })
watch(cache, () => {
  rows.value = []
  record.value = null
  editOpen.value = false
})
function edit() {
  if (!record.value || !canEdit.value) return
  for (const key of renewalFields) draft[key] = String(record.value[key] ?? '')
  editOpen.value = true
}
const intent = createConsoleMutationIntent('altoc-renewal-record')
async function save() {
  if (saving.value || !canEdit.value) return
  if (!String(draft.name || '').trim() || !draft.customer_id || !draft.owner_uid) {
    message.value = '请填写续约名称、客户和负责人'
    return
  }
  if (draft.expected_amount && !/^\d{1,16}(\.\d{1,2})?$/.test(draft.expected_amount)) {
    message.value = '预计金额最多保留两位小数'
    return
  }
  saving.value = true
  message.value = ''
  const body: Record<string, unknown> = Object.fromEntries(renewalFields.map(key => [key, draft[key]]))
  if (props.mode === 'detail') body.expectedVersion = Number(record.value?.row_version)
  try {
    let nextId = ''
    await intent.submit({ path: api.value, method: props.mode === 'new' ? 'POST' : 'PATCH', body }, async (request, key) => {
      const result = await $fetch<{ data: { id: string } }>(request.path, { method: request.method as 'POST' | 'PATCH', body: request.body, headers: { 'Idempotency-Key': key } })
      nextId = String(result.data.id)
    })
    intent.reset()
    editOpen.value = false
    if (props.mode === 'new') await navigateTo(`/altoc/renewals/${nextId}`)
    else await load()
  } catch (error: unknown) {
    fieldErrors.value = apfServerFieldErrors(error, renewalFields)
    const status = (error as { statusCode?: number }).statusCode
    message.value = status === 403 ? '当前范围不允许保存这条续约记录' : status === 409 ? '资料已变化或操作内容冲突，请刷新后核对' : status === 400 ? '资料格式或客户与合同归属不正确，请核对后再保存' : '保存未完成，可用相同内容重试'
  } finally {
    saving.value = false
  }
}
const title = computed(() => props.mode === 'list' ? '续约记录' : props.mode === 'new' ? '新建续约记录' : String(record.value?.name || '续约详情'))
</script>

<template>
  <UDashboardPanel id="altoc-renewals">
    <template #body>
      <ContentPageHeader
        :title="title"
        description="记录续约跟进情况。续约通过新合同和新服务期处理，不自动生成商机或延长原覆盖。"
        hosted
        breadcrumb="交付与服务 / 维护服务 / 续约记录"
      >
        <template #actions>
          <UButton
            v-if="mode === 'list' && canEdit"
            to="/altoc/renewals/new"
            icon="i-lucide-plus"
          >
            新建续约记录
          </UButton>
          <UButton
            v-else-if="mode === 'detail' && canEdit && record"
            icon="i-lucide-pencil"
            @click="edit"
          >
            编辑记录
          </UButton>
          <UButton
            v-if="mode !== 'list'"
            to="/altoc/renewals"
            color="neutral"
            variant="outline"
          >
            返回列表
          </UButton>
        </template>
      </ContentPageHeader>
      <UAlert
        v-if="permissionError"
        title="权限信息加载失败"
        color="error"
      />
      <CommonEmptyState
        v-else-if="loaded && !canRead"
        title="无权查看续约记录"
      />
      <UAlert
        v-if="message"
        :title="message"
        color="warning"
      />
      <UAlert
        v-if="directoryError"
        title="姓名读取失败，暂显示用户标识"
        color="warning"
      />
      <template v-if="ready">
        <template v-if="mode === 'list'">
          <UInput
            v-model="search"
            placeholder="搜索名称或编号"
            icon="i-lucide-search"
            @keydown.enter="flush"
          />
          <div class="overflow-x-auto">
            <UTable
              :data="rows"
              :columns="columns"
              :loading="loading"
            >
              <template #name-cell="{ row }">
                <NuxtLink
                  :to="`/altoc/renewals/${row.original.id}`"
                  class="text-primary"
                >{{ row.original.name }}</NuxtLink>
              </template>
              <template #owner_uid-cell="{ row }">
                {{ userName(String(row.original.owner_uid)) }}
              </template>
              <template #status-cell="{ row }">
                <UBadge
                  color="neutral"
                  variant="subtle"
                >
                  {{ labels[String(row.original.status)] || apfEnumLabel(row.original.status) }}
                </UBadge>
              </template>
              <template #expected_amount-cell="{ row }">
                {{ money(row.original.expected_amount) }}
              </template>
              <template #empty>
                <CommonEmptyState
                  title="暂无续约记录"
                  :description="canEdit ? '可新建续约记录，安排下一步跟进。' : '当前范围暂无记录。'"
                />
              </template>
            </UTable>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
              v-model:page="page"
              :total="total"
              :items-per-page="20"
            />
          </div>
        </template>
        <UCard v-else-if="mode === 'detail' && record">
          <dl class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <dt class="text-muted">
                续约编号
              </dt><dd>{{ record.code }}</dd>
            </div>
            <div>
              <dt class="text-muted">
                负责人
              </dt><dd>{{ userName(String(record.owner_uid)) }}</dd>
            </div>
            <div>
              <dt class="text-muted">
                类型 / 阶段 / 状态
              </dt><dd>{{ labels[String(record.renewal_type)] || apfEnumLabel(record.renewal_type) }} / {{ labels[String(record.stage)] || apfEnumLabel(record.stage) }} / {{ labels[String(record.status)] || apfEnumLabel(record.status) }}</dd>
            </div>
            <div>
              <dt class="text-muted">
                预计金额
              </dt><dd>{{ money(record.expected_amount) }}</dd>
            </div>
            <div v-if="record.expected_sign_date">
              <dt class="text-muted">
                预计签订日期
              </dt><dd>{{ record.expected_sign_date }}</dd>
            </div>
            <div v-if="record.reason">
              <dt class="text-muted">
                续约说明
              </dt><dd class="whitespace-pre-wrap break-words">
                {{ record.reason }}
              </dd>
            </div>
            <div v-if="record.next_action">
              <dt class="text-muted">
                下一步行动
              </dt><dd class="break-words">
                {{ record.next_action }} {{ record.next_action_due_date }}
              </dd>
            </div>
          </dl>
        </UCard>
        <UCard v-if="(mode === 'new' && canEdit) || editOpen">
          <form
            class="space-y-6"
            @submit.prevent="save"
          >
            <p class="text-sm text-muted">
              填写续约记录；保存不会改动原合同、服务协议或覆盖。
            </p>
            <fieldset class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <legend class="mb-3 font-semibold">
                基本信息
              </legend>
              <UFormField
                label="续约名称"
                required
                :error="fieldErrors.name"
              >
                <UInput
                  v-model="draft.name"
                  class="w-full"
                  maxlength="200"
                  required
                />
              </UFormField>
              <UFormField
                label="客户"
                required
                :error="fieldErrors.customer_id"
              >
                <AltocBusinessObjectSelect
                  v-model="draft.customer_id!"
                  kind="customers"
                  :enabled="canEdit && (mode === 'new' || editOpen)"
                />
              </UFormField>
              <UFormField
                label="关联合同"
                description="只能选择属于所选客户的合同"
                :error="fieldErrors.contract_id"
              >
                <AltocBusinessObjectSelect
                  v-model="draft.contract_id!"
                  kind="contracts"
                  :customer-id="draft.customer_id"
                  :enabled="canEdit && (mode === 'new' || editOpen)"
                />
              </UFormField>
              <UFormField
                label="续约类型"
                :error="fieldErrors.renewal_type"
              >
                <USelectMenu
                  v-model="draft.renewal_type"
                  value-key="value"
                  :items="options(['maintenance', 'upsell', 'cross_sell'])"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="负责人"
                :error="fieldErrors.owner_uid"
                required
              >
                <UserTreeSelector
                  v-model="owner"
                  selection-mode="single"
                />
              </UFormField>
              <UFormField label="负责部门">
                <APFDepartmentSelect v-model="draft.owner_dept_code!" />
              </UFormField>
            </fieldset>
            <fieldset class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <legend class="mb-3 font-semibold">
                跟进与预计签订
              </legend>
              <UFormField
                label="阶段"
                :error="fieldErrors.stage"
              >
                <USelectMenu
                  v-model="draft.stage"
                  value-key="value"
                  :items="options(['identified', 'contacted', 'proposal', 'negotiation', 'closed'])"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="状态"
                :error="fieldErrors.status"
              >
                <USelectMenu
                  v-model="draft.status"
                  value-key="value"
                  :items="options(['open', 'won', 'lost', 'cancelled'])"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="预计金额"
                :error="fieldErrors.expected_amount"
              >
                <UInput
                  v-model="draft.expected_amount"
                  inputmode="decimal"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="预计签订日期"
                :error="fieldErrors.expected_sign_date"
              >
                <UInput
                  v-model="draft.expected_sign_date"
                  type="date"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="风险等级"
                :error="fieldErrors.risk_level"
              >
                <USelectMenu
                  v-model="draft.risk_level"
                  value-key="value"
                  :items="[{ value: '', label: '未评估' }, ...options(['low', 'medium', 'high'])]"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="下一步截止日期"
                :error="fieldErrors.next_action_due_date"
              >
                <UInput
                  v-model="draft.next_action_due_date"
                  type="date"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="续约说明"
                :error="fieldErrors.reason"
              >
                <UTextarea
                  v-model="draft.reason"
                  class="w-full"
                  maxlength="500"
                />
              </UFormField>
              <UFormField
                label="下一步行动"
                :error="fieldErrors.next_action"
              >
                <UTextarea
                  v-model="draft.next_action"
                  class="w-full"
                  maxlength="500"
                />
              </UFormField>
            </fieldset>
            <div class="flex flex-wrap gap-3">
              <UButton
                type="submit"
                :loading="saving"
              >
                保存记录
              </UButton><UButton
                v-if="editOpen"
                color="neutral"
                variant="outline"
                @click="editOpen = false"
              >
                取消
              </UButton>
            </div>
          </form>
        </UCard>
      </template>
    </template>
  </UDashboardPanel>
</template>
