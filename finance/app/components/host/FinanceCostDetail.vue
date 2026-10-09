<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { useFinanceModule } from '../../../layer/useFinanceModule'
import { useFinanceCostAccess } from '../../composables/useFinanceCostAccess'
import { useFinanceCostDetail } from '../../composables/useFinanceCostDetail'
import { costMoney, costPercent, costReasons, comparisonFields, validCostMonth, type CostRow } from '../../utils/hostFinanceCost'

const route = useRoute()
const { hosted, moduleUrl } = useFinanceModule()
const project = computed(() => String(route.params.projectCode || ''))
const month = ref(validCostMonth(route.query.periodMonth) ? route.query.periodMonth : new Date().toISOString().slice(0, 7))
const { allowed, admin, permissionLoaded, permissionError, retryPermissions } = useFinanceCostAccess()
const { summary, preview, period, pending, saving, error, previewError, history, historyTotal, historyPage, historyPageSize, historyPending, historyError, selected, compared, comparePending, compareError, frozen, conflict, refresh, loadHistory, choose, compare, adoptLatest, execute } = useFinanceCostDetail(project, month, allowed, admin)
const missing = computed(() => preview.value?.missingInputs || summary.value?.cost_missing_inputs_json || ['missing_aims_time_entries'])
const ready = computed(() => (preview.value?.readiness || summary.value?.cost_readiness_status) === 'ready')
const closed = computed(() => preview.value?.closed || period.value?.closed === true)
const zeroPossible = computed(() => preview.value?.missingInputs.includes('missing_aims_time_entries'))
const fields = [{ key: 'receipt_amount', label: '已核销到账' }, { key: 'direct_expense_amount', label: '已确认支出' }, { key: 'labor_cost_amount', label: '人力成本' }, { key: 'other_cost_amount', label: '其它分摊' }, { key: 'gross_profit_amount', label: '毛利' }, { key: 'gross_margin_rate', label: '毛利率' }]
const columns: TableColumn<CostRow>[] = [{ accessorKey: 'revision', header: '版本', meta: { class: { td: 'w-20' } } }, { accessorKey: 'code', header: '历史批次' }, { accessorKey: 'labor_cost_amount', header: '人力成本', meta: { class: { th: 'text-right', td: 'w-36 text-right tabular-nums' } } }, { id: 'state', header: '状态' }, { id: 'select', header: '比较' }]
const allocationUrl = computed(() => `${moduleUrl('/project-cost-allocations')}?projectCode=${encodeURIComponent(project.value)}&periodMonth=${month.value}`)
</script>

<template>
  <UDashboardPanel id="finance-cost-detail">
    <template #body>
      <div class="min-w-0 p-4 sm:p-6">
        <ContentPageHeader
          v-if="hosted"
          :hosted="hosted"
          title="项目核算详情"
          :description="`项目 ${project} · ${month}`"
        >
          <template #actions>
            <UButton
              :to="moduleUrl('/project-accounting')"
              color="neutral"
              variant="outline"
            >
              返回列表
            </UButton><UButton
              :to="allocationUrl"
              color="neutral"
              variant="outline"
            >
              查看分摊
            </UButton>
          </template>
        </ContentPageHeader>
        <div class="mb-4 flex flex-wrap gap-2">
          <UInput
            v-model="month"
            type="month"
            aria-label="核算月份"
            :disabled="saving || !!frozen"
          /><UButton
            color="neutral"
            variant="outline"
            :loading="pending"
            :disabled="saving"
            @click="refresh"
          >
            刷新比较
          </UButton>
        </div>
        <UProgress
          v-if="!permissionLoaded && !permissionError"
          aria-label="加载财务权限"
        />
        <CommonEmptyState
          v-else-if="permissionError"
          title="权限加载失败"
          description="请重试确认权限。"
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
          description="您没有查看项目财务汇总的权限。"
        />
        <CommonEmptyState
          v-else-if="error"
          :title="error.startsWith('无权限') ? '无权限' : '加载失败'"
          :description="error"
        >
          <template #actions>
            <UButton @click="refresh">
              重试
            </UButton>
          </template>
        </CommonEmptyState>
        <template v-else>
          <UProgress
            v-if="pending"
            aria-label="加载核算与预览"
          />
          <UAlert
            v-if="closed"
            class="mb-4"
            color="neutral"
            title="成本期已关闭"
            description="历史仍可查看，不再开放重算或零投入确认。"
          />
          <UAlert
            v-if="!ready && !pending"
            class="mb-4"
            color="warning"
            title="缺少输入"
            :description="costReasons(missing).join('、') || '本月尚未生成完整成本批次，毛利暂不可用。'"
          />
          <div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <div
              v-for="field in fields"
              :key="field.key"
              class="min-w-0 rounded-lg border border-default p-3"
            >
              <p class="text-sm text-muted">
                {{ field.label }}
              </p><p class="mt-1 break-words tabular-nums">
                {{ field.key === 'gross_margin_rate' ? costPercent(summary?.[field.key]) : costMoney(summary?.[field.key]) }}<span v-if="field.key !== 'gross_margin_rate'"> {{ summary?.currency_code }}</span>
              </p>
            </div>
          </div>
          <section
            v-if="admin"
            class="mt-5 rounded-lg border border-default p-4"
            aria-label="成本重算预览"
          >
            <h2 class="font-semibold">
              重算预览
            </h2><p class="mt-1 text-sm text-muted">
              采用月末有效任职、成本参数及 CN 工作日历。项目工时比例可超过 100%。
            </p>
            <CommonEmptyState
              v-if="previewError"
              :title="previewError.startsWith('无权限') ? '无权限' : '预览加载失败'"
              :description="previewError"
            >
              <template #actions>
                <UButton @click="refresh">
                  重试
                </UButton>
              </template>
            </CommonEmptyState>
            <template v-else-if="preview">
              <p class="mt-3">
                本次人力成本：{{ costMoney(preview.laborCostAmount) }} {{ preview.currency }} · {{ preview.readiness === 'ready' ? '已就绪' : '缺少输入' }}
              </p><p class="mt-1 break-all text-xs text-muted">
                输入摘要：{{ preview.inputHash }}
              </p>
              <UAlert
                v-if="conflict"
                class="mt-3"
                color="warning"
                title="版本或输入已变更"
                description="原选择已保留。请比较旧请求与最新预览，再明确采用新版本。"
              />
              <dl
                v-if="conflict && frozen"
                class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <div>
                  <dt class="text-sm text-muted">
                    原请求
                  </dt><dd class="break-all text-sm">
                    版本 {{ frozen.body.expectedVersion }} · {{ frozen.preview.laborCostAmount ?? '未就绪' }} · {{ frozen.body.expectedInputHash }}
                  </dd>
                </div><div>
                  <dt class="text-sm text-muted">
                    最新预览
                  </dt><dd class="break-all text-sm">
                    版本 {{ preview.expectedVersion }} · {{ preview.laborCostAmount ?? '未就绪' }} · {{ preview.inputHash }}
                  </dd>
                </div>
              </dl>
              <p
                v-if="frozen && !conflict"
                class="mt-3 text-sm text-warning"
              >
                原请求已保留；重试使用同一版本、输入摘要与幂等键。
              </p>
              <div class="mt-4 flex flex-wrap gap-2">
                <UButton
                  v-if="conflict"
                  color="warning"
                  :disabled="saving || pending"
                  @click="adoptLatest"
                >
                  采用最新预览
                </UButton>
                <template v-else>
                  <UButton
                    :loading="saving"
                    :disabled="(closed && !frozen) || pending || (!!frozen && frozen.action !== 'recalculate')"
                    @click="execute('recalculate')"
                  >
                    {{ frozen?.action === 'recalculate' ? '重试原重算请求' : '确认重算' }}
                  </UButton>
                  <UButton
                    v-if="zeroPossible || frozen?.action === 'confirm-zero'"
                    color="warning"
                    variant="outline"
                    :disabled="(closed && !frozen) || saving || pending || (!!frozen && frozen.action !== 'confirm-zero')"
                    @click="execute('confirm-zero')"
                  >
                    确认零投入
                  </UButton>
                  <UButton
                    color="warning"
                    variant="outline"
                    :disabled="(!frozen && (closed || !ready || !preview.batchCode)) || saving || pending || (!!frozen && frozen.action !== 'close')"
                    @click="execute('close')"
                  >
                    关闭成本期
                  </UButton>
                </template>
              </div>
            </template>
          </section>
          <p
            v-else
            class="mt-4 text-sm text-muted"
          >
            当前只可查看汇总和分摊总额；重算与关期需要 Finance 项目核算管理权限。
          </p>
          <section
            class="mt-6"
            aria-label="不可变成本历史"
          >
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 class="font-semibold">
                历史批次
              </h2><div class="flex gap-2">
                <UButton
                  color="neutral"
                  variant="outline"
                  :disabled="selected.length !== 2"
                  :loading="comparePending"
                  @click="compare"
                >
                  比较所选两批
                </UButton><UButton
                  color="neutral"
                  variant="ghost"
                  :loading="historyPending"
                  @click="loadHistory"
                >
                  刷新历史
                </UButton>
              </div>
            </div>
            <CommonEmptyState
              v-if="historyError"
              :title="historyError.startsWith('无权限') ? '无权限' : '历史加载失败'"
              :description="historyError"
            />
            <template v-else>
              <UTable
                :data="history"
                :columns="columns"
                :loading="historyPending"
                class="hidden sm:block"
              >
                <template #code-cell="{ row }">
                  <span
                    class="block max-w-64 truncate"
                    :title="String(row.original.code)"
                  >{{ row.original.code }}</span>
                </template>
                <template #labor_cost_amount-cell="{ row }">
                  {{ costMoney(row.original.labor_cost_amount) }} {{ row.original.currency_code }}
                </template>
                <template #state-cell="{ row }">
                  <UBadge
                    :color="row.original.readiness_status === 'ready' ? 'success' : 'warning'"
                    variant="subtle"
                  >
                    {{ row.original.readiness_status === 'ready' ? '已就绪' : '缺少输入' }}
                  </UBadge>
                </template>
                <template #select-cell="{ row }">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    :aria-pressed="selected.includes(String(row.original.code))"
                    @click="choose(String(row.original.code))"
                  >
                    {{ selected.includes(String(row.original.code)) ? '取消选择' : '选择比较' }}
                  </UButton>
                </template>
                <template #empty>
                  <CommonEmptyState
                    title="暂无历史批次"
                    description="完成首次重算后会保留不可变历史。"
                  />
                </template>
              </UTable>
              <div class="space-y-2 sm:hidden">
                <UProgress
                  v-if="historyPending"
                  aria-label="加载历史"
                /><div
                  v-for="row in history"
                  :key="String(row.code)"
                  class="min-w-0 rounded-lg border border-default p-3"
                >
                  <p class="break-all text-sm">
                    第 {{ row.revision }} 批 · {{ row.code }}
                  </p><p>{{ costMoney(row.labor_cost_amount) }} {{ row.currency_code }} · {{ row.readiness_status === 'ready' ? '已就绪' : '缺少输入' }}</p><UButton
                    class="mt-2"
                    color="neutral"
                    variant="outline"
                    :aria-pressed="selected.includes(String(row.code))"
                    @click="choose(String(row.code))"
                  >
                    {{ selected.includes(String(row.code)) ? '取消选择' : '选择比较' }}
                  </UButton>
                </div><CommonEmptyState
                  v-if="!historyPending && !history.length"
                  title="暂无历史批次"
                />
              </div>
              <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span class="text-sm text-muted">共 {{ historyTotal }} 条</span><UPagination
                  v-model:page="historyPage"
                  :total="historyTotal"
                  :items-per-page="historyPageSize"
                  :sibling-count="0"
                  :show-edges="false"
                />
              </div>
            </template>
            <UAlert
              v-if="compareError"
              class="mt-4"
              color="error"
              title="比较加载失败"
              :description="compareError"
            />
            <div
              v-if="compared.length === 2"
              class="mt-4 space-y-3"
            >
              <h3 class="font-medium">
                历史比较（第 {{ compared[0]?.revision }} 批 / 第 {{ compared[1]?.revision }} 批）
              </h3><div
                v-for="field in comparisonFields"
                :key="field.key"
                class="rounded-lg border border-default p-3"
              >
                <p class="text-sm text-muted">
                  {{ field.label }}
                </p><div class="mt-1 grid min-w-0 grid-cols-2 gap-3">
                  <p
                    v-for="(row, index) in compared"
                    :key="index"
                    class="min-w-0 break-all"
                  >
                    {{ costMoney(row[field.key]) }}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
