<script setup lang="ts">
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { useFinanceModule } from '../../../layer/useFinanceModule'
import { ledgerPath, ledgerApi, ledgerTitles, ledgerWriteMessage, type FinanceLedgerRow } from '../../utils/hostFinanceLedger'
import { createFinanceIntent, decimalInput } from '../../utils/hostFinanceForms'

const props = defineProps<{ kind: 'expenses' | 'claims' | 'project-requests' | 'payment-requests' }>()
const route = useRoute()
const router = useRouter()
const { hosted, apiUrl, moduleUrl, sessionScope } = useFinanceModule()
const { loaded, error: permissionError, hasPermission, loadPermissions } = usePermissions()
onMounted(() => {
  void loadPermissions()
})
const code = computed(() => String(route.params.code || ''))
const allowed = computed(() => loaded.value && !permissionError.value && hasPermission('expenses', 'edit'))
const form = reactive<Record<string, string>>({ currencyCode: 'CNY' })
const items = ref([{ description: '', amount: '', occurredAt: '' }])
const original = ref<FinanceLedgerRow | null>(null)
const comparison = ref<FinanceLedgerRow | null>(null)
const pending = ref(false)
const saving = ref(false)
const loadError = ref('')
const saveError = ref('')
const toast = useToast()
const intent = createFinanceIntent()
let frozenPayload: Record<string, unknown> | null = null
let generation = 0
const fields = computed(() => [
  ...(props.kind === 'expenses' ? [{ key: 'description', label: '事由' }, { key: 'expenseAmount', label: '支出金额' }, { key: 'expenseDate', label: '支出日期', type: 'date' }, { key: 'payeeName', label: '收款方' }] : [{ key: 'title', label: '申请标题' }, { key: 'remark', label: '备注' }, ...(props.kind === 'payment-requests' ? [{ key: 'paymentType', label: '付款类型' }, { key: 'payeeName', label: '收款方' }, { key: 'requestedAmount', label: '申请金额' }, { key: 'plannedPayDate', label: '计划付款日', type: 'date' }, { key: 'bankAccountId', label: '付款账户 ID' }] : [])]),
  { key: 'projectCode', label: props.kind === 'project-requests' ? '项目编码（必填）' : '项目编码' },
  { key: 'contractCode', label: '合同编码' }, { key: 'customerCode', label: '客户编码（须与合同一致）' }, { key: 'currencyCode', label: '币种' }
])
const snake = (key: string) => key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)
async function load(compare = false) {
  const epoch = ++generation
  if (!allowed.value || !code.value) return
  pending.value = true
  loadError.value = ''
  try {
    const response = await $fetch<{ data: FinanceLedgerRow }>(apiUrl(`/${ledgerApi(props.kind)}/${encodeURIComponent(code.value)}`), { retry: 0 })
    if (epoch !== generation) return
    if (compare) comparison.value = response.data
    else {
      original.value = response.data
      for (const field of fields.value) form[field.key] = String(response.data[snake(field.key)] || '').slice(0, field.type === 'date' ? 10 : undefined)
      if (Array.isArray(response.data.items)) items.value = response.data.items.map((item: Record<string, unknown>) => ({ description: String(item.description || ''), amount: String(item.amount || ''), occurredAt: String(item.occurred_at || '').slice(0, 10) }))
    }
  } catch {
    if (epoch === generation) loadError.value = '单据加载失败，请重试'
  } finally {
    if (epoch === generation) pending.value = false
  }
}
watch(() => [allowed.value, code.value, sessionScope?.value], () => {
  generation++
  pending.value = false
  saving.value = false
  loadError.value = ''
  saveError.value = ''
  frozenPayload = null
  intent.reset()
  original.value = null
  comparison.value = null
  Object.keys(form).forEach((key) => {
    Reflect.deleteProperty(form, key)
  })
  form.currencyCode = 'CNY'
  items.value = [{ description: '', amount: '', occurredAt: '' }]
  void load()
}, { immediate: true })
onScopeDispose(() => {
  generation++
})
function payload() {
  const body: Record<string, unknown> = {}
  for (const field of fields.value) {
    const value = form[field.key]?.trim() || ''
    if (value) body[field.key] = ['expenseAmount', 'requestedAmount'].includes(field.key) ? decimalInput(value, 2) : field.key === 'bankAccountId' ? Number(value) : value
    else if (code.value && !['title', 'expenseAmount', 'expenseDate', 'currencyCode', 'requestedAmount', 'paymentType', 'payeeName'].includes(field.key) && !(props.kind === 'project-requests' && field.key === 'projectCode')) body[field.key] = null
  }
  if (props.kind !== 'expenses' && props.kind !== 'payment-requests') body.items = items.value.map(item => ({ description: item.description.trim(), amount: decimalInput(item.amount, 2), ...(props.kind === 'claims' && item.occurredAt ? { occurredAt: item.occurredAt } : {}) }))
  if (code.value) {
    if (!original.value) throw new Error('详情尚未加载')
    body.expectedVersion = original.value.row_version
  }
  return body
}
function useComparedVersion() {
  if (!comparison.value || frozenPayload) return
  original.value = comparison.value
  comparison.value = null
  intent.reset()
}
async function save() {
  if (!allowed.value || saving.value) return
  const epoch = generation
  saving.value = true
  saveError.value = ''
  try {
    const body = frozenPayload || payload()
    frozenPayload = body
    const response = await $fetch<{ data: FinanceLedgerRow }>(apiUrl(`/${ledgerApi(props.kind)}${code.value ? `/${encodeURIComponent(code.value)}` : ''}`), { method: code.value ? 'PATCH' : 'POST', body, headers: { 'Idempotency-Key': intent.key({ kind: props.kind, code: code.value, body }) }, retry: 0 })
    if (epoch !== generation) return
    intent.reset()
    frozenPayload = null
    toast.add({ title: code.value ? '草稿已保存' : '草稿已创建', color: 'success' })
    await router.push(moduleUrl(`${ledgerPath(props.kind)}/${response.data.code}`))
  } catch (failure) {
    if (epoch !== generation) return
    const status = Number((failure as { statusCode?: number, status?: number }).statusCode || (failure as { status?: number }).status || 0)
    if ([400, 403, 409].includes(status)) frozenPayload = null
    saveError.value = failure instanceof Error && !status && !frozenPayload ? failure.message : ledgerWriteMessage(failure)
    toast.add({ title: saveError.value, color: 'error' })
  } finally {
    if (epoch === generation) saving.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="finance-spend-form">
    <template #body>
      <div class="p-4 sm:p-6">
        <ContentPageHeader
          v-if="hosted"
          :hosted="hosted"
          :title="`${code ? '编辑' : '新建'}${ledgerTitles[kind]}`"
          description="保存草稿不会提交审批，也不会确认实际付款。"
        >
          <template #actions>
            <UButton
              :to="moduleUrl(ledgerPath(kind))"
              color="neutral"
              variant="outline"
            >
              返回列表
            </UButton>
          </template>
        </ContentPageHeader>
        <UProgress
          v-if="!loaded || pending"
          aria-label="加载财务权限或单据"
        />
        <CommonEmptyState
          v-else-if="permissionError"
          title="权限加载失败"
        >
          <template #actions>
            <UButton @click="loadPermissions()">
              重试
            </UButton>
          </template>
        </CommonEmptyState>
        <CommonEmptyState
          v-else-if="!allowed"
          title="无权限"
          description="您没有编辑支出单据的权限。"
        />
        <CommonEmptyState
          v-else-if="loadError && !original"
          title="加载失败"
          :description="loadError"
        >
          <template #actions>
            <UButton @click="load()">
              重试
            </UButton>
          </template>
        </CommonEmptyState>
        <CommonEmptyState
          v-else-if="original && !['draft', 'rejected'].includes(original.status)"
          title="当前单据不可编辑"
          description="已提交审批或已确认的单据不能修改，请返回详情查看当前状态。"
        >
          <template #actions>
            <UButton
              :to="moduleUrl(`${ledgerPath(kind)}/${code}`)"
              color="neutral"
              variant="outline"
            >
              返回详情
            </UButton>
          </template>
        </CommonEmptyState>
        <form
          v-else
          class="max-w-[720px] space-y-4"
          @submit.prevent="save"
        >
          <UAlert
            v-if="frozenPayload"
            color="warning"
            title="保存结果未确认；当前草稿已保留，请重试同一请求。"
          />
          <div class="grid min-w-0 gap-4 sm:grid-cols-2">
            <UFormField
              v-for="field in fields"
              :key="field.key"
              :label="field.label"
            >
              <USelect
                v-if="field.key === 'paymentType'"
                v-model="form[field.key]"
                :items="[{ label: '供应商付款', value: 'supplier' }, { label: '客户退款', value: 'customer_refund' }, { label: '借款', value: 'loan' }, { label: '费用', value: 'expense' }, { label: '其他', value: 'other' }]"
                :disabled="!!frozenPayload"
                class="w-full"
              />
              <UInput
                v-else
                v-model="form[field.key]"
                :type="field.type || 'text'"
                :disabled="!!frozenPayload"
                class="w-full"
              />
            </UFormField>
          </div>
          <fieldset
            v-if="kind !== 'expenses' && kind !== 'payment-requests'"
            class="min-w-0 space-y-3"
            :disabled="!!frozenPayload"
          >
            <legend class="font-semibold">
              支出明细（服务端计算合计）
            </legend>
            <div
              v-for="(item, index) in items"
              :key="index"
              class="grid min-w-0 gap-3 rounded-lg border border-default p-3 sm:grid-cols-2"
            >
              <UFormField :label="`明细 ${index + 1} 事由`">
                <UInput
                  v-model="item.description"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="金额">
                <UInput
                  v-model="item.amount"
                  inputmode="decimal"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                v-if="kind === 'claims'"
                label="发生日期"
              >
                <UInput
                  v-model="item.occurredAt"
                  type="date"
                  class="w-full"
                />
              </UFormField>
              <UButton
                v-if="items.length > 1"
                type="button"
                color="neutral"
                variant="outline"
                :aria-label="`移除明细 ${index + 1}`"
                @click="items.splice(index, 1)"
              >
                移除明细
              </UButton>
            </div>
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              :disabled="items.length >= 100"
              @click="items.push({ description: '', amount: '', occurredAt: '' })"
            >
              追加明细
            </UButton>
          </fieldset>
          <UAlert
            v-if="saveError"
            color="error"
            :title="saveError"
          >
            <template #actions>
              <UButton
                v-if="code"
                type="button"
                color="neutral"
                variant="outline"
                @click="load(true)"
              >
                刷新比较
              </UButton>
            </template>
          </UAlert>
          <UAlert
            v-if="comparison"
            color="info"
            :title="`服务器版本 ${comparison.row_version}（草稿仍保留）`"
          />
          <div
            v-if="comparison"
            class="space-y-3 rounded-lg border border-default p-3"
          >
            <dl class="grid min-w-0 gap-3 sm:grid-cols-2">
              <div
                v-for="field in fields"
                :key="field.key"
                class="min-w-0"
              >
                <dt class="text-sm text-muted">
                  服务器：{{ field.label }}
                </dt><dd class="break-all">
                  {{ comparison[snake(field.key)] || '—' }}
                </dd>
              </div>
            </dl>
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              @click="useComparedVersion"
            >
              采用服务器版本继续编辑（保留草稿）
            </UButton>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              type="submit"
              :loading="saving"
            >
              {{ frozenPayload ? '重试同一保存请求' : '保存草稿' }}
            </UButton><UButton
              :to="moduleUrl(ledgerPath(kind))"
              color="neutral"
              variant="outline"
            >
              返回
            </UButton>
          </div>
        </form>
      </div>
    </template>
  </UDashboardPanel>
</template>
