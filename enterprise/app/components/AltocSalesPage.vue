<script setup lang="ts">
import APFDepartmentSelect from './APFDepartmentSelect.vue'
import AltocBusinessObjectSelect from './AltocBusinessObjectSelect.vue'
import { apfServerFieldErrors, apfEnumLabel } from '../utils/apfFormPresentation'
import { formatMoney } from '../../../foundation/app/utils/format'
import type { TableColumn } from '@nuxt/ui'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'
import AltocSalesSupport from './AltocSalesSupport.vue'
import { SOURCE_TYPE_OPTIONS, LEAD_STATUS_OPTIONS, OPPORTUNITY_STATUS_OPTIONS, FORECAST_CATEGORY_OPTIONS, INVALID_REASON_OPTIONS, OPPORTUNITY_WON_REASON_OPTIONS, OPPORTUNITY_LOST_REASON_OPTIONS, OPPORTUNITY_PAUSE_REASON_OPTIONS } from '../../../altoc/app/types/altoc'

const props = defineProps<{ resource: 'lead' | 'opportunity', detail?: boolean }>()
type Row = Record<string, string | number | boolean | null>
const route = useRoute()
const { user } = useAuth()
const { loaded, error: permissionError, hasPermission, loadPermissions } = usePermissions()
onMounted(() => {
  void loadPermissions()
})
const can = (action: string) => loaded.value && !permissionError.value && hasPermission(props.resource, action)
const title = computed(() => props.resource === 'lead' ? '线索' : '商机')
const base = computed(() => `/altoc/api/v1/${props.resource === 'lead' ? 'leads' : 'opportunities'}`)
const id = computed(() => String(route.params[`${props.resource}Id`] || ''))
const scope = useState<string>('enterprise-cache-scope', () => '')
const { status: accessStatus } = useEnterpriseNavigationAccess()
const page = ref(1)
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const rows = ref<Row[]>([])
const record = ref<Row | null>(null)
const stages = ref<Array<{ id: string | number, name: string, stage_kind: string }>>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
let epoch = 0
const owners = computed(() => [...rows.value.map(r => String(r.owner_uid || r.owner_user_id || '')), String(record.value?.owner_uid || ''), String(user.value || '')])
const { userName, departmentName, directoryError, refresh: refreshDirectory } = useAltocDirectoryLabels(owners)
const toast = useToast()
const { confirm } = useConfirm()
const statuses = Object.fromEntries([...LEAD_STATUS_OPTIONS, ...OPPORTUNITY_STATUS_OPTIONS].map(o => [o.value, o.label]))
const labels: Record<string, string> = { name: '名称', org_name: '公司名称', source_type: '来源', source_detail: '来源说明', need_summary: '需求概要', project_type: '项目类型', estimated_budget: '预计预算', budget_status: '预算状态', expected_procurement_date: '预计采购日期', procurement_mode: '采购方式', source_evidence_url: '线索依据链接', contact_name: '联系人', contact_mobile: '手机', contact_email: '邮箱', owner_uid: '负责人', owner_dept_code: '归属部门', next_action: '下一步动作', next_action_due_at: '下一步截止时间', remark: '备注', customerId: '客户', stageId: '目标阶段', forecast_category: '预测分类', currency_code: '币种', amount_tax_inclusive: '预计金额', expected_sign_date: '预计签约日期', expected_payment_date: '预计回款日期', risk_level: '风险等级', risk_reason: '风险说明', competitor_info: '竞争情况', activity_type: '跟进方式', subject: '跟进主题', content: '内容', result_summary: '结果', activity_at: '发生时间', invalid_reason_code: '作废原因类别', invalid_reason: '作废说明', customer_name: '新客户名称', opportunity_name: '新商机名称', contactId: '已有联系人', ack_similar_opportunity: '确认已有商机后继续创建', change_reason: '阶段变更说明', won_reason_code: '赢单原因类别', won_reason: '赢单说明', lost_reason_code: '输单原因类别', lost_reason: '输单说明', pause_reason_code: '暂停原因类别', pause_reason: '暂停说明' }
const columns: TableColumn<Row>[] = [{ accessorKey: 'code', header: '编号' }, { accessorKey: 'name', header: '名称' }, { accessorKey: 'owner_uid', header: '负责人' }, { accessorKey: 'status', header: '状态' }, ...(props.resource === 'opportunity' ? [{ accessorKey: 'amount_tax_inclusive', header: '预计金额' }] : [])]
async function load() {
  const current = ++epoch

  if (!scope.value || accessStatus.value !== 'ready') {
    rows.value = []
    record.value = null
    return
  }

  loading.value = true

  error.value = ''

  try {
    const result = await $fetch<{ code: number, data: Row & { items: Row[], total: number } }>(`${base.value}${props.detail ? `/${id.value}` : ''}`, { query: props.detail ? {} : { page: page.value, pageSize: 20, ...(debounced.value ? { search: debounced.value } : {}) } })

    if (current !== epoch) return

    if (props.detail) {
      record.value = result.data
      stages.value = (result.data as unknown as { stages?: typeof stages.value }).stages || []
    } else {
      rows.value = result.data.items
      total.value = result.data.total
    }
  } catch {
    if (current === epoch) {
      error.value = '资料加载失败或无查看权限'
      rows.value = []
      record.value = null
    }
  } finally {
    if (current === epoch) loading.value = false
  }
}
watch([id, page, debounced, scope, accessStatus], load, { immediate: true })
onBeforeUnmount(() => {
  epoch++
  rows.value = []
  record.value = null
})
const editor = ref(false)
const action = ref('create')
const draft = reactive<Record<string, string | boolean>>({})
const saving = ref(false)
const formError = ref('')
const fieldErrors = ref<Record<string, string>>({})
const intent = createConsoleMutationIntent('altoc-sales')
const selectedOwner = computed({ get: () => draft.owner_uid ? [String(draft.owner_uid)] : [], set: (v: string[]) => {
  draft.owner_uid = v[0] || ''
} })
const permission = (a: string) => a === 'assign' ? 'assign' : a === 'convert' ? 'convert' : a === 'disqualify' ? 'disqualify' : a === 'activity' ? 'activity' : ['transition', 'close-won', 'close-lost', 'pause', 'reopen'].includes(a) ? 'transition' : 'edit'
const leadFields = ['name', 'org_name', 'source_type', 'source_detail', 'need_summary', 'contact_name', 'contact_mobile', 'contact_email', 'source_evidence_url', 'project_type', 'estimated_budget', 'budget_status', 'expected_procurement_date', 'procurement_mode', 'next_action', 'next_action_due_at', 'remark']
const opportunityFields = ['name', 'source_type', 'source_detail', 'forecast_category', 'currency_code', 'amount_tax_inclusive', 'expected_sign_date', 'expected_payment_date', 'next_action', 'next_action_due_at', 'risk_level', 'risk_reason', 'competitor_info', 'remark']
const fields = computed(() => {
  const a = action.value

  if (a === 'create' || a === 'update') return [...(props.resource === 'lead' ? leadFields : opportunityFields), ...(a === 'create' ? ['owner_uid', 'owner_dept_code', ...(props.resource === 'opportunity' ? ['customerId'] : [])] : [])]

  if (a === 'assign') return ['owner_uid', 'owner_dept_code']

  if (a === 'disqualify') return ['invalid_reason_code', 'invalid_reason']

  if (a === 'convert') return ['customerId', 'customer_name', 'contactId', 'contact_name', 'contact_mobile', 'contact_email', 'opportunity_name', 'owner_uid', 'owner_dept_code', 'ack_similar_opportunity']

  if (a === 'activity') return ['activity_type', 'subject', 'activity_at', 'content', 'result_summary', 'next_action', 'next_action_due_at']

  return [...(['transition', 'reopen'].includes(a) ? ['stageId'] : []), 'amount_tax_inclusive', 'expected_sign_date', 'expected_payment_date', 'forecast_category', 'next_action', 'next_action_due_at', 'competitor_info', ...({ 'close-won': ['won_reason_code', 'won_reason'], 'close-lost': ['lost_reason_code', 'lost_reason'], 'pause': ['pause_reason_code', 'pause_reason'] }[a] || []), 'change_reason']
})
const groups = computed(() => [
  { title: '基本信息', keys: fields.value.filter(k => !['owner_uid', 'owner_dept_code', 'contact_name', 'contact_mobile', 'contact_email', 'next_action', 'next_action_due_at', 'remark', 'content', 'result_summary'].includes(k)) },
  { title: '联系方式', keys: fields.value.filter(k => k.startsWith('contact_')) },
  { title: '归属', keys: fields.value.filter(k => ['owner_uid', 'owner_dept_code'].includes(k)) },
  { title: '跟进与说明', keys: fields.value.filter(k => ['next_action', 'next_action_due_at', 'remark', 'content', 'result_summary'].includes(k)) }
].filter(g => g.keys.length))
const availableActions = computed(() => (props.resource === 'lead' ? ['assign', 'activity', 'convert', 'disqualify'] : ['assign', 'activity', 'transition', 'close-won', 'close-lost', 'pause', 'reopen']).filter(a => can(permission(a))))
const actionLabels: Record<string, string> = { 'create': '新建', 'update': '编辑', 'assign': '调整负责人', 'disqualify': '作废线索', 'convert': '转为客户与商机', 'activity': '记录跟进', 'transition': '推进阶段', 'close-won': '赢单', 'close-lost': '输单', 'pause': '暂停', 'reopen': '重新打开' }
function begin(a: string) {
  if (!can(permission(a))) return

  if (!intent.reset()) {
    toast.add({ title: '请先重试未完成的操作', color: 'warning' })
    return
  }

  action.value = a

  Object.keys(draft).forEach(k => Reflect.deleteProperty(draft, k))

  fields.value.forEach((k) => {
    draft[k] = String(record.value?.[k] ?? '')
  })

  if (a === 'create') {
    draft.owner_uid = String(user.value || '')
    draft.source_type = 'referral'
    draft.forecast_category = 'pipeline'
    draft.currency_code = 'CNY'
  }

  if (a === 'convert') draft.ack_similar_opportunity = false

  fieldErrors.value = {}
  formError.value = ''
  editor.value = true
}
function options(k: string) {
  if (k === 'stageId') return stages.value.filter(s => s.stage_kind === 'normal').map(s => ({ label: s.name, value: String(s.id) }))
  if (k === 'source_type') return SOURCE_TYPE_OPTIONS

  if (k === 'forecast_category') return FORECAST_CATEGORY_OPTIONS
  if (k === 'invalid_reason_code') return INVALID_REASON_OPTIONS
  if (k === 'won_reason_code') return OPPORTUNITY_WON_REASON_OPTIONS
  if (k === 'lost_reason_code') return OPPORTUNITY_LOST_REASON_OPTIONS
  if (k === 'pause_reason_code') return OPPORTUNITY_PAUSE_REASON_OPTIONS
  if (k === 'budget_status') return [{ label: '尚不明确', value: 'unknown' }, { label: '申请中', value: 'applying' }, { label: '已批准', value: 'approved' }, { label: '已拨付', value: 'allocated' }]
  if (k === 'project_type') return [{ label: '企业项目', value: 'tob' }, { label: '政务项目', value: 'tog' }, { label: '续约', value: 'renewal' }, { label: '增购', value: 'upsell' }, { label: '渠道', value: 'channel' }]
  if (k === 'procurement_mode') return [{ label: '直接采购', value: 'direct' }, { label: '竞争性磋商', value: 'competitive_consultation' }, { label: '公开招标', value: 'open_tender' }, { label: '框架协议', value: 'framework' }, { label: '其他', value: 'other' }]
  if (k === 'risk_level') return [{ label: '高', value: 'high' }, { label: '中', value: 'medium' }, { label: '低', value: 'low' }]

  if (k === 'activity_type') return [{ label: '拜访', value: 'visit' }, { label: '电话', value: 'call' }, { label: '演示', value: 'demo' }, { label: '会议', value: 'meeting' }, { label: '投标', value: 'tender' }, { label: '备忘', value: 'memo' }]

  return []
}
function required(k: string) {
  return (action.value === 'create' && ['name', 'owner_uid', ...(props.resource === 'lead' ? ['org_name', 'source_type', 'need_summary', 'next_action', 'next_action_due_at'] : ['customerId', 'next_action', 'next_action_due_at'])].includes(k)) || (action.value === 'assign' && k === 'owner_uid') || (action.value === 'activity' && ['activity_type', 'subject', 'activity_at'].includes(k)) || (action.value === 'disqualify' && k.startsWith('invalid_reason')) || (['transition', 'reopen'].includes(action.value) && k === 'stageId') || (action.value === 'close-won' && k.startsWith('won_reason')) || (action.value === 'close-lost' && k.startsWith('lost_reason')) || (action.value === 'pause' && k.startsWith('pause_reason'))
}
async function save() {
  if (saving.value || !can(permission(action.value))) return

  fieldErrors.value = Object.fromEntries(fields.value.filter(k => required(k) && !String(draft[k] || '').trim()).map(k => [k, '请填写此项']))

  if (Object.keys(fieldErrors.value).length) return

  if (['disqualify', 'close-lost'].includes(action.value) && !await confirm({ title: `${actionLabels[action.value]}「${record.value?.name}」`, message: '提交后将关闭当前业务对象。', tone: 'danger' })) return

  const payload: Record<string, unknown> = Object.fromEntries(fields.value.filter(k => draft[k] !== '').map(k => [k, draft[k]]))

  for (const k of ['activity_at', 'next_action_due_at']) if (payload[k]) payload[k] = String(payload[k]).replace('T', ' ') + (String(payload[k]).length === 16 ? ':00' : '')

  if (action.value !== 'create') payload.expectedVersion = record.value?.row_version

  const method = action.value === 'update' ? 'PATCH' : 'POST'

  const path = `${base.value}${action.value === 'create' ? '' : `/${id.value}${action.value === 'update' ? '' : `/${action.value}`}`}`

  saving.value = true
  formError.value = ''

  try {
    const done = await intent.submit({ method, path, body: payload }, (request, key) => $fetch(request.path, { method: request.method, body: request.body, headers: { 'Idempotency-Key': key } }))

    if (!done) return

    editor.value = false
    toast.add({ title: '操作完成', color: 'success' })
    await load()
  } catch (e) {
    fieldErrors.value = apfServerFieldErrors(e, fields.value)
    formError.value = Object.keys(fieldErrors.value).length ? '请核对标出的字段及关联关系' : '操作未完成，请保留原意图重试；版本冲突时先刷新资料'
  } finally {
    saving.value = false
  }
}
function money(v: unknown) {
  return formatMoney(v === null || v === undefined || v === '' ? null : String(v))
}
const detailFields = computed(() => [...new Set([...leadFields, ...opportunityFields])].filter(k => record.value?.[k] !== undefined && record.value?.[k] !== null && record.value?.[k] !== ''))
</script>

<template>
  <UDashboardPanel>
    <template #body>
      <ContentPageHeader
        :title="detail ? String(record?.name || title) : title"
        description="维护客户需求、跟进记录和销售推进事实"
        hosted
        :breadcrumb="`销售 / 客户经营 / ${title}`"
      >
        <template #actions>
          <UButton
            v-if="can('edit')"
            @click="begin(detail ? 'update' : 'create')"
          >
            {{ detail ? '编辑' : `新建${title}` }}
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            :loading="loading"
            @click="load"
          >
            刷新
          </UButton>
        </template>
      </ContentPageHeader>
      <UAlert
        v-if="permissionError"
        title="权限信息加载失败"
        color="error"
      />
      <UAlert
        v-if="directoryError"
        title="人员或部门名称暂不可用"
        color="warning"
      >
        <template #actions>
          <UButton
            color="neutral"
            variant="outline"
            @click="refreshDirectory()"
          >
            重试
          </UButton>
        </template>
      </UAlert>
      <UAlert
        v-if="error"
        :title="error"
        color="error"
      />
      <template v-if="!detail">
        <UInput
          v-model="search"
          placeholder="搜索名称或编号"
          class="w-full sm:max-w-sm"
          @keyup.enter="flush"
        />
        <UTable
          :data="rows"
          :columns="columns"
          :loading="loading"
          class="min-w-0 overflow-x-auto"
        >
          <template #name-cell="{ row }">
            <NuxtLink
              :to="`/altoc/${resource === 'lead' ? 'leads' : 'opportunities'}/${row.original.id}`"
              class="text-primary"
            >{{ row.original.name }}</NuxtLink>
          </template>
          <template #owner_uid-cell="{ row }">
            {{ userName(row.original.owner_uid || row.original.owner_user_id) }}
          </template>
          <template #status-cell="{ row }">
            <UBadge
              color="neutral"
              variant="subtle"
            >
              {{ statuses[String(row.original.status)] || apfEnumLabel(row.original.status) }}
            </UBadge>
          </template>
          <template #amount_tax_inclusive-cell="{ row }">
            <div class="text-right tabular-nums">
              {{ money(row.original.amount_tax_inclusive) }}
            </div>
          </template>
          <template #empty>
            <CommonEmptyState
              :title="`暂无${title}`"
              :description="can('edit') ? `可新建${title}开始维护` : '当前范围没有可见记录'"
            />
          </template>
        </UTable>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
            v-model:page="page"
            :total="total"
            :items-per-page="20"
          />
        </div>
      </template>
      <template v-else-if="record">
        <div class="flex flex-wrap items-center gap-2">
          <UBadge color="neutral">
            {{ statuses[String(record.status)] || apfEnumLabel(record.status) }}
          </UBadge><span class="text-sm text-muted">{{ record.code }} · {{ userName(record.owner_uid) }} · {{ departmentName(record.owner_dept_code) }}</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="a in availableActions"
            :key="a"
            color="neutral"
            variant="outline"
            @click="begin(a)"
          >
            {{ actionLabels[a] }}
          </UButton>
        </div>
        <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div
            v-for="k in detailFields"
            :key="k"
            class="min-w-0"
          >
            <dt class="text-sm text-muted">
              {{ labels[k] }}
            </dt><dd class="break-words">
              {{ ['amount_tax_inclusive', 'estimated_budget'].includes(k) ? money(record[k]) : (options(k).find(o => o.value === record?.[k])?.label || record[k]) }}
            </dd>
          </div>
        </dl>
        <AltocSalesSupport
          :id="id"
          :resource="resource"
          :version="Number(record.row_version)"
          :customer-id="String(record.customer_id || '')"
          :can-edit="can('edit')"
          @changed="load"
        />
      </template>
      <USlideover
        v-model:open="editor"
        :title="`${actionLabels[action]}${title}`"
        description="按分组填写资料，提交时校验当前权限与资料版本"
        :ui="{ content: 'w-full sm:max-w-3xl' }"
        :dismissible="!saving"
      >
        <template #body>
          <UAlert
            v-if="formError"
            :title="formError"
            color="error"
          />
          <p
            v-if="action === 'convert'"
            class="text-sm text-muted"
          >
            已有客户填写 ID；未填写则按公司名称匹配或新建。转化不会重复创建客户、联系人和商机。
          </p>
          <p
            v-if="fields.includes('stageId')"
            class="text-sm text-muted"
          >
            选择当前销售管道内的阶段；服务端复核阶段准入条件。
          </p>
          <section
            v-for="group in groups"
            :key="group.title"
            class="mb-6"
          >
            <h3 class="mb-3 font-semibold">
              {{ group.title }}
            </h3><div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <UFormField
                v-for="k in group.keys"
                :key="k"
                :label="labels[k]"
                :ui="{ label: 'after:content-none' }"
                :required="required(k)"
                :error="fieldErrors[k]"
                :class="['content', 'remark', 'need_summary', 'owner_dept_code'].includes(k) ? 'sm:col-span-2' : ''"
              >
                <template #label>
                  {{ labels[k] }}<span
                    v-if="required(k)"
                    aria-hidden="true"
                    class="ml-1 text-error"
                  >*</span>
                </template>
                <UserTreeSelector
                  v-if="k === 'owner_uid'"
                  v-model="selectedOwner"
                  selection-mode="single"
                  hide-committees
                  width-class="w-full"
                />
                <APFDepartmentSelect
                  v-else-if="k === 'owner_dept_code'"
                  :model-value="String(draft.owner_dept_code || '')"
                  @update:model-value="draft.owner_dept_code = $event || ''"
                />
                <AltocBusinessObjectSelect
                  v-else-if="k === 'customerId'"
                  v-model="draft[k] as string"
                  kind="customers"
                  :enabled="editor"
                />
                <AltocBusinessObjectSelect
                  v-else-if="k === 'contactId'"
                  v-model="draft[k] as string"
                  kind="contacts"
                  :parent-id="String(draft.customerId || record?.customer_id || '')"
                  :enabled="editor"
                />
                <UCheckbox
                  v-else-if="k === 'ack_similar_opportunity'"
                  v-model="draft[k] as boolean"
                  :label="labels[k]"
                />
                <USelectMenu
                  v-else-if="options(k).length"
                  v-model="draft[k] as string"
                  value-key="value"
                  :items="options(k)"
                  class="w-full"
                />
                <UTextarea
                  v-else-if="['content', 'remark', 'need_summary', 'risk_reason', 'competitor_info'].includes(k)"
                  v-model="draft[k] as string"
                  class="w-full"
                />
                <UInput
                  v-else
                  v-model="draft[k] as string"
                  :type="k.endsWith('_at') ? 'datetime-local' : k.endsWith('_date') ? 'date' : 'text'"
                  class="w-full"
                />
              </UFormField>
            </div>
          </section>
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              :disabled="saving"
              @click="editor = false"
            >
              取消
            </UButton><UButton
              :loading="saving"
              @click="save"
            >
              保存
            </UButton>
          </div>
        </template>
      </USlideover>
    </template>
  </UDashboardPanel>
</template>
