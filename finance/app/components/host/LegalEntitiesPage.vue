<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import type { LegalEntity, LegalEntityInput } from '../../types/hostFinance'
import { createHostFinanceClient, type FinanceFetch } from '../../utils/hostFinanceClient'
import { createFinanceIntent, financeWriteMessage } from '../../utils/hostFinanceForms'
import { financeListRouteQuery } from '../../utils/financeWorkbench'
import { useFinancePagedList } from '../../composables/useFinancePagedList'
import FinanceColumnView from './FinanceColumnView.vue'
import LegalEntityDetails from './LegalEntityDetails.vue'
import { useFinanceModule } from '../../../layer/useFinanceModule'

const { hosted, apiUrl, sessionScope } = useFinanceModule()
const api = createHostFinanceClient($fetch as FinanceFetch, apiUrl)
const { loaded, error: permissionError, hasPermission, loadPermissions } = usePermissions()
onMounted(() => void loadPermissions())
const canView = computed(() => loaded.value && !permissionError.value && hasPermission('legal_entities', 'view'))
const canEdit = computed(() => canView.value && hasPermission('legal_entities', 'edit'))
const route = useRoute()
const router = useRouter()
const initial = financeListRouteQuery(route.query, 'entities')
const { query, items, total, page, pageSize, pending, error, search, status, flush, refresh } = useFinancePagedList<LegalEntity>(query => api.entities(query), canView, { ...initial, page: Number(initial.page || 1) })
watch(query, (value) => {
  const next = financeListRouteQuery({ ...value, page: String(value.page) }, 'entities')
  if (JSON.stringify(next) !== JSON.stringify(financeListRouteQuery(route.query, 'entities'))) void router.replace({ query: next })
})
const visible = items
const detailCode = ref('')
const detailOpen = ref(false)
function showDetails(row: LegalEntity) {
  detailCode.value = row.code
  detailOpen.value = true
}
const optionalColumns = [{ value: 'entity_type', label: '主体类型' }, { value: 'registered_address', label: '注册地址' }, { value: 'invoice_tax_no', label: '税号' }, { value: 'sort_no', label: '排序号' }, { value: 'remark', label: '备注' }]
const displayed = ref<string[]>([])
const columns = computed<TableColumn<LegalEntity>[]>(() => [{ accessorKey: 'code', header: '编码' }, { accessorKey: 'name', header: '名称' }, { accessorKey: 'short_name', header: '简称' }, { accessorKey: 'unified_social_credit_code', header: '统一社会信用代码' }, { accessorKey: 'invoice_title', header: '开票抬头' }, ...(hasPermission('bank_accounts', 'view') ? [{ accessorKey: 'account_count', header: '账户数' }] : []), { accessorKey: 'status', header: '状态' }, ...optionalColumns.filter(column => displayed.value.includes(column.value)).map(column => ({ accessorKey: column.value, header: column.label })), { id: 'actions', header: '操作' }])
const open = ref(false)
const editing = ref<LegalEntity | null>(null)
const comparison = ref<LegalEntity | null>(null)
const version = ref(0)
const saving = ref(false)
const saveError = ref('')
const intent = createFinanceIntent()
const toast = useToast()
const { confirm } = useConfirm()
const form = reactive({ name: '', shortName: '', unifiedSocialCreditCode: '', entityType: 'company' as LegalEntity['entity_type'], invoiceTitle: '', invoiceTaxNo: '', registeredAddress: '', sortNo: 0, remark: '' })
function edit(row: LegalEntity | null) {
  editing.value = row
  version.value = row?.row_version || 0
  comparison.value = null
  Object.assign(form, { name: row?.name || '', shortName: row?.short_name || '', unifiedSocialCreditCode: row?.unified_social_credit_code || '', entityType: row?.entity_type || 'company', invoiceTitle: row?.invoice_title || '', invoiceTaxNo: row?.invoice_tax_no || '', registeredAddress: row?.registered_address || '', sortNo: row?.sort_no || 0, remark: row?.remark || '' })
  saveError.value = ''
  intent.reset()
  open.value = true
}
async function compare() {
  if (!editing.value || saving.value)
    return
  saving.value = true
  try {
    comparison.value = (await api.entity(editing.value.code)).data
  } catch (failure) {
    toast.add({ title: financeWriteMessage(failure), color: 'error' })
  } finally {
    saving.value = false
  }
}
async function submit() {
  if (!canEdit.value || saving.value)
    return
  if (!form.name.trim()) {
    saveError.value = '请填写法人主体名称'
    return
  }
  if (!Number.isSafeInteger(Number(form.sortNo)) || Number(form.sortNo) < 0 || Number(form.sortNo) > 1000000) {
    saveError.value = '排序号须为 0 至 1000000 的整数'
    return
  }
  const body: LegalEntityInput = { ...form, name: form.name.trim(), shortName: form.shortName?.trim() || null, unifiedSocialCreditCode: form.unifiedSocialCreditCode?.trim() || null, invoiceTitle: form.invoiceTitle?.trim() || null, invoiceTaxNo: form.invoiceTaxNo?.trim() || null, registeredAddress: form.registeredAddress?.trim() || null, remark: form.remark?.trim() || null, sortNo: Number(form.sortNo) }
  const payload = editing.value ? { ...body, expectedVersion: version.value } : body
  saving.value = true
  saveError.value = ''
  try {
    const key = intent.key({ code: editing.value?.code || null, ...payload })
    if (editing.value)
      await api.updateEntity(editing.value.code, { ...body, expectedVersion: version.value }, key)
    else
      await api.createEntity(body, key)
    open.value = false
    intent.reset()
    toast.add({ title: editing.value ? '法人主体已更新' : '法人主体已新建', color: 'success' })
    await refresh()
  } catch (failure) {
    saveError.value = financeWriteMessage(failure)
    toast.add({ title: saveError.value, color: 'error' })
  } finally {
    saving.value = false
  }
}
async function deactivate(row: LegalEntity) {
  if (!canEdit.value || saving.value || !(await confirm({ tone: 'warning', title: '停用法人主体', message: `停用「${row.name}」后，${row.account_count === undefined ? '已关联的账户' : `已关联的 ${row.account_count} 个账户`}与合同不受影响，但不能再被新对象选择。` })))
    return
  saving.value = true
  const body = { status: 'inactive' as const, expectedVersion: row.row_version }
  try {
    await api.updateEntity(row.code, body, intent.key({ code: row.code, ...body }))
    intent.reset()
    toast.add({ title: '法人主体已停用', color: 'success' })
    await refresh()
  } catch (failure) {
    toast.add({ title: financeWriteMessage(failure), color: 'error' })
  } finally {
    saving.value = false
  }
}
watch(() => sessionScope?.value, () => {
  open.value = false
  detailOpen.value = false
  detailCode.value = ''
  editing.value = null
  comparison.value = null
  intent.reset()
  Object.assign(form, { name: '', shortName: '', unifiedSocialCreditCode: '', invoiceTitle: '', invoiceTaxNo: '', registeredAddress: '', remark: '' })
})
</script>

<template>
  <UDashboardPanel :ui="{ body: 'p-0' }">
    <template #body>
      <div class="min-w-0 space-y-4 p-4 sm:p-6">
        <ContentPageHeader
          :hosted="hosted"
          title="法人主体目录"
          breadcrumb="经营 / 账户与资金"
        >
          <template #actions>
            <UButton
              v-if="canEdit"
              icon="i-lucide-plus"
              @click="edit(null)"
            >
              新建主体
            </UButton>
          </template>
        </ContentPageHeader>
        <CommonEmptyState
          v-if="permissionError"
          title="权限加载失败"
        >
          <UButton @click="loadPermissions({ force: true })">
            重试
          </UButton>
        </CommonEmptyState>
        <UProgress
          v-else-if="!loaded"
          aria-label="加载权限"
        />
        <CommonEmptyState
          v-else-if="!canView"
          title="无权查看法人主体"
          icon="i-lucide-lock-keyhole"
        />
        <CommonEmptyState
          v-else-if="error"
          title="法人主体目录不可用"
          :description="error"
        >
          <UButton @click="refresh">
            重试
          </UButton>
        </CommonEmptyState>
        <template v-else>
          <div class="flex flex-wrap items-center gap-3">
            <UInput
              v-model="search"
              placeholder="搜索编码、名称或简称"
              aria-label="搜索法人主体"
              class="w-full sm:w-72"
              @keyup.enter="flush"
            />
            <USelect
              v-model="status"
              :items="[{ label: '全部主体', value: 'all' }, { label: '启用主体', value: 'active' }, { label: '停用主体', value: 'inactive' }]"
              aria-label="主体状态"
              class="w-full sm:w-36"
            />
            <UButton
              color="neutral"
              variant="outline"
              :loading="pending"
              @click="refresh"
            >
              刷新
            </UButton>
            <FinanceColumnView
              v-model="displayed"
              :options="optionalColumns"
              view-key="entities"
              :filters="{ status }"
              @restore="!Object.keys(initial).length && (status = $event.status === 'closed' ? 'all' : $event.status || 'all')"
            />
          </div>
          <UTable
            :data="visible"
            :columns="columns"
            :loading="pending"
            class="hidden w-full sm:block"
            :ui="{ td: 'max-w-56 truncate' }"
          >
            <template #name-cell="{ row }">
              <UButton
                color="primary"
                variant="link"
                class="max-w-48 truncate"
                @click="showDetails(row.original)"
              >
                {{ row.original.name }}
              </UButton>
            </template>
            <template #invoice_title-cell="{ row }">
              <span class="block max-w-48 truncate">{{ row.original.invoice_title || '—' }}</span>
            </template>
            <template #account_count-cell="{ row }">
              <span class="block text-right tabular-nums">{{ row.original.account_count ?? '—' }}</span>
            </template>
            <template #entity_type-cell="{ row }">
              {{ { company: '公司', branch: '分支机构', other: '其他' }[row.original.entity_type] }}
            </template>
            <template #status-cell="{ row }">
              <UBadge :color="row.original.status === 'active' ? 'success' : 'neutral'">
                {{ row.original.status === 'active' ? '启用' : '停用' }}
              </UBadge>
            </template>
            <template #actions-cell="{ row }">
              <UButton
                v-if="canEdit"
                color="neutral"
                variant="ghost"
                @click="edit(row.original)"
              >
                编辑
              </UButton><UButton
                v-if="canEdit && row.original.status === 'active'"
                color="warning"
                variant="ghost"
                :disabled="saving"
                @click="deactivate(row.original)"
              >
                停用
              </UButton>
            </template>
            <template #empty>
              <CommonEmptyState
                title="暂无法人主体"
                description="调整搜索条件，或使用页头入口新建。"
              />
            </template>
          </UTable>
          <div class="space-y-3 sm:hidden">
            <UProgress
              v-if="pending"
              aria-label="加载法人主体"
            /><CommonEmptyState
              v-else-if="!visible.length"
              title="暂无法人主体"
            /><article
              v-for="row in visible"
              :key="row.code"
              class="min-w-0 space-y-2 rounded-lg border border-default p-3"
            >
              <UButton
                color="primary"
                variant="link"
                class="max-w-full truncate"
                @click="showDetails(row)"
              >
                {{ row.name }}
              </UButton><p class="break-all text-sm text-muted">
                {{ row.code }} · {{ row.short_name || '—' }} · {{ row.status === 'active' ? '启用' : '停用' }}
              </p><p class="break-all text-sm">
                {{ row.unified_social_credit_code || '未登记信用代码' }} · {{ row.invoice_title || '未登记开票抬头' }}
              </p><p
                v-if="Object.hasOwn(row, 'account_count')"
                class="text-sm"
              >
                账户数：{{ row.account_count ?? '—' }}
              </p><UButton
                v-if="canEdit"
                color="neutral"
                variant="outline"
                @click="edit(row)"
              >
                编辑
              </UButton><UButton
                v-if="canEdit && row.status === 'active'"
                color="warning"
                :disabled="saving"
                @click="deactivate(row)"
              >
                停用
              </UButton>
            </article>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm text-muted">共 {{ total }} 条</span>
            <UPagination
              v-model:page="page"
              :total="total"
              :items-per-page="pageSize"
              :sibling-count="0"
              :show-edges="false"
            />
          </div>
        </template>
        <LegalEntityDetails
          v-model:open="detailOpen"
          :code="detailCode"
          :allowed="canView"
        />
        <UModal
          v-model:open="open"
          :ui="{ wrapper: 'min-w-0 flex-1 pe-8', title: 'break-words' }"
          :title="editing ? `编辑法人主体：${editing.name}` : '新建法人主体'"
          description="更多资料可按需展开。"
          :dismissible="!saving"
          :close="!saving"
        >
          <template #body>
            <form
              class="space-y-4"
              @submit.prevent="submit"
            >
              <UFormField
                label="名称"
                required
              >
                <UInput
                  v-model="form.name"
                  maxlength="200"
                  :disabled="saving"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="简称">
                <UInput
                  v-model="form.shortName"
                  maxlength="200"
                  :disabled="saving"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="统一社会信用代码">
                <UInput
                  v-model="form.unifiedSocialCreditCode"
                  maxlength="50"
                  :disabled="saving"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="主体类型">
                <USelect
                  v-model="form.entityType"
                  :items="[{ label: '公司', value: 'company' }, { label: '分支机构', value: 'branch' }, { label: '其他', value: 'other' }]"
                  :disabled="saving"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="开票抬头">
                <UInput
                  v-model="form.invoiceTitle"
                  maxlength="200"
                  :disabled="saving"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="纳税人识别号">
                <UInput
                  v-model="form.invoiceTaxNo"
                  maxlength="50"
                  :disabled="saving"
                  class="w-full"
                />
              </UFormField>
              <details class="space-y-3">
                <summary class="cursor-pointer text-primary">
                  更多
                </summary><UFormField label="注册地址">
                  <UInput
                    v-model="form.registeredAddress"
                    maxlength="500"
                    :disabled="saving"
                    class="w-full"
                  />
                </UFormField><UFormField label="排序号">
                  <UInput
                    v-model="form.sortNo"
                    type="number"
                    min="0"
                    max="1000000"
                    :disabled="saving"
                    class="w-full"
                  />
                </UFormField><UFormField label="备注">
                  <UTextarea
                    v-model="form.remark"
                    maxlength="500"
                    :disabled="saving"
                    class="w-full"
                  />
                </UFormField>
              </details>
              <UAlert
                v-if="saveError"
                color="error"
                :title="saveError"
              >
                <template #actions>
                  <UButton
                    v-if="editing"
                    color="neutral"
                    :loading="saving"
                    @click="compare"
                  >
                    刷新比较（保留草稿）
                  </UButton>
                </template>
              </UAlert>
              <div
                v-if="comparison"
                class="space-y-2 rounded-lg border border-warning p-3"
              >
                <p class="break-words">
                  最新 v{{ comparison.row_version }}：{{ comparison.name }} · {{ comparison.short_name }} · {{ comparison.invoice_title }} · {{ comparison.status === 'active' ? '启用' : '停用' }} · 信用代码：{{ comparison.unified_social_credit_code || '—' }} · 税号：{{ comparison.invoice_tax_no || '—' }} · 类型：{{ comparison.entity_type }} · 地址：{{ comparison.registered_address || '—' }} · 排序：{{ comparison.sort_no }} · 备注：{{ comparison.remark || '—' }}
                </p><UButton
                  color="warning"
                  @click="version = comparison.row_version; comparison = null; saveError = ''"
                >
                  已比较，沿用最新版本保存草稿
                </UButton>
              </div>
              <div class="flex flex-wrap gap-2">
                <UButton
                  type="submit"
                  :disabled="!canEdit"
                  :loading="saving"
                >
                  保存
                </UButton><UButton
                  color="neutral"
                  :disabled="saving"
                  @click="open = false"
                >
                  取消
                </UButton>
              </div>
            </form>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
