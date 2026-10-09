<script setup lang="ts">
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import type { PeopleCostParameter, PeopleCostParameterInput } from '../../types/hostFinance'
import { createHostFinanceClient, type FinanceFetch } from '../../utils/hostFinanceClient'
import { createFinanceIntent, decimalInput, validEffectiveRange, financeWriteMessage } from '../../utils/hostFinanceForms'
import { useFinanceModule } from '../../../layer/useFinanceModule'

const { hosted, moduleUrl, apiUrl, sessionScope } = useFinanceModule()
const api = createHostFinanceClient($fetch as FinanceFetch, apiUrl)
const route = useRoute()
const router = useRouter()
const { hasPermission, loaded, error: permissionError, loadPermissions } = usePermissions()
// Host composition does not run the standalone Finance permission middleware.
// Load explicitly: a loaded-first permission guard cannot trigger lazy loading.
onMounted(() => {
  void loadPermissions()
})
const canView = computed(() => loaded.value && !permissionError.value && hasPermission('settings', 'admin'))
const canEdit = computed(() => loaded.value && !permissionError.value && hasPermission('settings', 'admin'))
const code = computed(() => String(route.params.code || ''))
const editing = computed(() => !!code.value)
const original = ref<PeopleCostParameter | null>(null)
const comparison = ref<PeopleCostParameter | null>(null)
const pending = ref(false)
const saving = ref(false)
const loadError = ref('')
const saveError = ref('')
const toast = useToast()
const { confirm } = useConfirm()
const intent = createFinanceIntent()
const form = reactive({ name: '', effectiveFrom: '', effectiveTo: '', baseSalary: '0.00', welfareCostRate: '0.0000', managementAllocationRate: '0.0000', resourceAllocationCost: '0.00', currencyCode: 'CNY', status: 'active' as PeopleCostParameter['status'], remark: '' })
watch(() => sessionScope?.value, () => {
  original.value = null
  comparison.value = null
  intent.reset()
  Object.assign(form, { name: '', effectiveFrom: '', effectiveTo: '', baseSalary: '0.00', welfareCostRate: '0.0000', managementAllocationRate: '0.0000', resourceAllocationCost: '0.00', currencyCode: 'CNY', status: 'active', remark: '' })
})
let generation = 0
async function load(compare = false) {
  const epoch = ++generation
  if (!canView.value || !editing.value) {
    original.value = null
    comparison.value = null
    pending.value = false
    return
  }
  pending.value = true
  loadError.value = ''
  try {
    const response = await api.parameter(code.value)
    if (epoch !== generation) return
    if (compare) comparison.value = response.data
    else {
      original.value = response.data
      const row = response.data
      Object.assign(form, { name: row.name, effectiveFrom: row.effective_from.slice(0, 10), effectiveTo: row.effective_to?.slice(0, 10) || '', baseSalary: row.base_salary, welfareCostRate: row.welfare_cost_rate, managementAllocationRate: row.management_allocation_rate, resourceAllocationCost: row.resource_allocation_cost, currencyCode: row.currency_code, status: row.status, remark: row.remark || '' })
    }
  } catch {
    if (epoch === generation) loadError.value = '参数详情暂不可用，请稍后重试'
  } finally {
    if (epoch === generation) pending.value = false
  }
}
watch(() => [code.value, canView.value, sessionScope?.value], () => {
  void load()
}, { immediate: true })
onScopeDispose(() => {
  generation++
})
function useLatestVersion() {
  if (!comparison.value) return
  original.value = comparison.value
  comparison.value = null
  saveError.value = ''
}
async function submit() {
  if (saving.value || !canEdit.value || (editing.value && !original.value)) return
  if (!form.name.trim() || !validEffectiveRange(form.effectiveFrom, form.effectiveTo || null) || !/^[A-Z]{3}$/.test(form.currencyCode)) {
    saveError.value = '请填写名称、有效日期区间和三位大写币种编码'
    return
  }
  let body: PeopleCostParameterInput
  try {
    body = { ...form, name: form.name.trim(), effectiveTo: form.effectiveTo || null, baseSalary: decimalInput(form.baseSalary, 2), welfareCostRate: decimalInput(form.welfareCostRate, 4), managementAllocationRate: decimalInput(form.managementAllocationRate, 4), resourceAllocationCost: decimalInput(form.resourceAllocationCost, 2), remark: form.remark || null }
  } catch (error) {
    saveError.value = (error as Error).message
    return
  }
  if (form.status === 'inactive' && original.value?.status !== 'inactive' && !(await confirm({ tone: 'warning', title: '停用成本参数', message: `停用「${form.name}」将影响后续人力成本计算；既有快照和版本历史保留。` }))) return
  const payload = editing.value ? { ...body, expectedVersion: original.value!.row_version } : body
  saving.value = true
  saveError.value = ''
  try {
    if (editing.value) await api.updateParameter(code.value, payload as PeopleCostParameterInput & { expectedVersion: number }, intent.key({ code: code.value || null, ...payload }))
    else await api.createParameter(body, intent.key({ code: code.value || null, ...payload }))
    intent.reset()
    toast.add({ title: editing.value ? '成本参数已更新' : '成本参数版本已新建', color: 'success' })
    await router.push(moduleUrl('/settings/people-cost-parameters'))
  } catch (failure) {
    saveError.value = financeWriteMessage(failure)
    toast.add({ title: saveError.value, color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #body>
      <div class="min-w-0 space-y-4 p-4 sm:p-6">
        <ContentPageHeader
          :hosted="hosted"
          :title="editing ? '编辑人力成本参数' : '新建成本参数版本'"
          description="参数变更不重算历史快照。同一时点只允许一条启用参数；具体区间冲突由服务端复核。"
          breadcrumb="设置 / 业务配置"
        >
          <template #actions>
            <UButton
              color="neutral"
              variant="outline"
              :disabled="saving"
              :to="moduleUrl('/settings/people-cost-parameters')"
            >
              返回列表
            </UButton>
          </template>
        </ContentPageHeader>
        <UProgress
          v-if="pending"
          aria-label="加载成本参数"
        />
        <CommonEmptyState
          v-if="permissionError"
          icon="i-lucide-circle-alert"
          title="权限加载失败"
          description="无法加载财务权限，请稍后重试。"
        >
          <UButton
            color="neutral"
            variant="outline"
            @click="loadPermissions({ force: true })"
          >
            重试
          </UButton>
        </CommonEmptyState>
        <div
          v-else-if="!loaded"
          role="status"
          class="space-y-2"
        >
          <UProgress aria-label="加载财务权限" />
          <p class="text-sm text-muted">
            正在加载财务权限…
          </p>
        </div>
        <CommonEmptyState
          v-else-if="!canView"
          title="无权查看成本参数"
        />
        <CommonEmptyState
          v-else-if="loadError && !original"
          title="加载失败"
          :description="loadError"
        >
          <UButton
            color="neutral"
            variant="outline"
            @click="load()"
          >
            重试
          </UButton>
        </CommonEmptyState>
        <form
          v-else
          class="max-w-[720px] space-y-4"
          @submit.prevent="submit"
        >
          <UAlert
            v-if="loaded && !canEdit"
            color="info"
            title="当前仅可查看，您没有编辑成本参数的权限。"
          />
          <UAlert
            v-if="saveError"
            color="error"
            :title="saveError"
          >
            <template #actions>
              <UButton
                v-if="editing"
                color="neutral"
                variant="outline"
                :loading="pending"
                @click="load(true)"
              >
                刷新比较（保留草稿）
              </UButton>
            </template>
          </UAlert>
          <div
            v-if="comparison"
            class="space-y-2 break-words rounded-lg border border-warning p-3"
          >
            <p>最新版本 v{{ comparison.row_version }}：{{ comparison.name }}，{{ comparison.effective_from }} 至 {{ comparison.effective_to || '长期' }}</p><p class="text-sm">
              基本工资 {{ comparison.base_salary }}；福利费率 {{ comparison.welfare_cost_rate }}；管理系数 {{ comparison.management_allocation_rate }}；资源成本 {{ comparison.resource_allocation_cost }} {{ comparison.currency_code }}
            </p><UButton
              color="warning"
              class="whitespace-normal text-left"
              @click="useLatestVersion"
            >
              已比较，沿用最新版本继续保存草稿
            </UButton>
          </div>
          <fieldset
            :disabled="saving || pending || !canEdit || !loaded"
            class="grid gap-4 sm:grid-cols-2"
          >
            <UFormField
              label="参数名称"
              required
              class="sm:col-span-2"
            >
              <UInput
                v-model="form.name"
                maxlength="100"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="生效日期"
              required
            >
              <UInput
                v-model="form.effectiveFrom"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="失效日期"
              help="不填表示长期有效"
            >
              <UInput
                v-model="form.effectiveTo"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="基本工资"
              required
            >
              <UInput
                v-model="form.baseSalary"
                inputmode="decimal"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="固定资源分摊成本"
              required
            >
              <UInput
                v-model="form.resourceAllocationCost"
                inputmode="decimal"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="福利成本费率"
              help="小数比例，例如 0.2000 为20%"
            >
              <UInput
                v-model="form.welfareCostRate"
                inputmode="decimal"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="管理分摊系数"
              help="小数比例，最多四位小数"
            >
              <UInput
                v-model="form.managementAllocationRate"
                inputmode="decimal"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="币种"
              required
            >
              <UInput
                v-model="form.currencyCode"
                maxlength="3"
                class="w-full"
              />
            </UFormField>
            <UFormField label="状态">
              <USelect
                v-model="form.status"
                :items="[{ label: '启用', value: 'active' }, { label: '停用', value: 'inactive' }]"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="备注"
              class="sm:col-span-2"
            >
              <UTextarea
                v-model="form.remark"
                maxlength="500"
                class="w-full"
              />
            </UFormField>
          </fieldset>
          <UButton
            v-if="canEdit"
            type="submit"
            :loading="saving"
            :disabled="pending || (editing && !original)"
          >
            保存
          </UButton>
        </form>
      </div>
    </template>
  </UDashboardPanel>
</template>
