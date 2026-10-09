<script setup lang="ts">
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { useFinanceModule } from '../../../layer/useFinanceModule'
import { useFinanceCostAccess } from '../../composables/useFinanceCostAccess'
import { costMoney, costTitles, costReadMessage, validCostMonth, type CostKind, type CostRow } from '../../utils/hostFinanceCost'

const props = defineProps<{
  kind: CostKind
}>()
const route = useRoute()
const { hosted, apiUrl, moduleUrl, sessionScope } = useFinanceModule()
const { allowed, permissionLoaded, permissionError, retryPermissions } = useFinanceCostAccess(props.kind === 'employee-costs')
const row = ref<CostRow | null>(null), pending = ref(false), error = ref('')
let generation = 0
async function load() {
  const epoch = ++generation
  row.value = null
  error.value = ''
  pending.value = false
  if (!allowed.value)
    return
  pending.value = true
  try {
    const response = await $fetch<{
      data: CostRow | null
    }>(apiUrl(`/${props.kind}/${encodeURIComponent(String(route.params.code))}`), { query: { periodMonth: route.query.periodMonth, projectCode: route.query.projectCode }, retry: 0 })
    if (epoch === generation && allowed.value)
      row.value = response.data
  } catch (failure) {
    if (epoch === generation)
      error.value = costReadMessage(failure)
  } finally {
    if (epoch === generation)
      pending.value = false
  }
}
watch(() => [allowed.value, route.params.code, route.query.periodMonth, route.query.projectCode, sessionScope?.value], () => {
  void load()
}, { immediate: true })
onScopeDispose(() => {
  generation++
})
const fields = computed(() => props.kind === 'employee-costs' ? { employee_uid: '员工', period_month: '月份', standard_cost_amount: '月标准成本', currency_code: '币种', row_version: '当前版本' } : { code: '分摊编号', project_code: '项目', period_month: '月份', amount: '分摊总额', currency_code: '币种', allocation_type: '分摊类型', allocation_basis: '依据', basis_value: '依据值', rule_code: '计算规则', batch_code: '批次', status: '状态' })
const back = computed(() => `${moduleUrl(`/${props.kind}`)}?periodMonth=${validCostMonth(route.query.periodMonth) ? route.query.periodMonth : new Date().toISOString().slice(0, 7)}`)
</script>

<template>
  <UDashboardPanel id="finance-cost-record">
    <template #body>
      <div class="min-w-0 p-4 sm:p-6">
        <ContentPageHeader
          v-if="hosted"
          :hosted="hosted"
          :title="`${costTitles[kind]}详情`"
        >
          <template #actions>
            <UButton
              :to="back"
              color="neutral"
              variant="outline"
            >
              返回列表
            </UButton>
          </template>
        </ContentPageHeader>
        <UProgress
          v-if="(!permissionLoaded || pending) && !permissionError"
          aria-label="加载成本详情"
        />
        <CommonEmptyState
          v-else-if="permissionError"
          title="权限加载失败"
          description="请重新加载权限。"
        >
          <template #actions>
            <UButton @click="retryPermissions">
              重试
            </UButton>
          </template>
        </CommonEmptyState>
        <CommonEmptyState
          v-else-if="!allowed"
          title="无权限"
          description="当前财务或人员权限不足。"
        />
        <CommonEmptyState
          v-else-if="error"
          :title="error.startsWith('无权限') ? '无权限' : '加载失败'"
          :description="error"
        >
          <template #actions>
            <UButton @click="load">
              重试
            </UButton>
          </template>
        </CommonEmptyState>
        <CommonEmptyState
          v-else-if="!row"
          title="记录不存在"
          description="请返回列表重新选择。"
        />
        <dl
          v-else
          class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <div
            v-for="(label, key) in fields"
            :key="key"
            class="min-w-0 rounded-lg border border-default p-3"
          >
            <dt class="text-sm text-muted">
              {{ label }}
            </dt><dd class="mt-1 break-words">
              {{ costMoney(row[key]) }}
            </dd>
          </div>
        </dl>
      </div>
    </template>
  </UDashboardPanel>
</template>
