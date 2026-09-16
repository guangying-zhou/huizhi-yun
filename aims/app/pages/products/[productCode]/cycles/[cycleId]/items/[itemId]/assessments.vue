<script setup lang="ts">
import type { ProductAssessment, AssessmentDimension } from '~/types/productAssessment'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '事项评估历史', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const cycleId = computed(() => String(route.params.cycleId || ''))
const itemId = computed(() => String(route.params.itemId || ''))
const { page, pageSize } = useListPage({ pageSize: 10 })
const labels: Record<AssessmentDimension, string> = { strategic: '战略匹配', user_value: '用户价值', business: '经营价值', risk: '风险降低', confidence: '置信度', effort_person_days: '总投入（人日）' }
const riceLabels = { impact: '影响系数', confidence: '置信度', effort_person_days: '总投入（人日）' }
function dimensionValue(assessment: ProductAssessment, dimension: AssessmentDimension | 'impact') {
  return dimension === 'impact' ? assessment.rice_impact : assessment[dimension]
}
const polarity = { supporting: '支持', opposing: '反对', neutral: '中性' }
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles/${cycleId.value}/items/${itemId.value}/assessments`, {
  server: false, query: computed(() => ({ page: page.value, pageSize })),
  transform: (response: { code: number, data: { items: ProductAssessment[], total: number, cycle_status: string, cycle_biz_id: string, item_biz_id: string } }) => {
    const result = response.data
    if (response.code !== 0 || !result || result.cycle_biz_id !== cycleId.value || result.item_biz_id !== itemId.value || !Number.isSafeInteger(result.total) || result.total < 0 || !Array.isArray(result.items) || result.items.some(item => !Number.isSafeInteger(item.id) || item.id < 1 || typeof item.is_current !== 'boolean' || typeof item.stale !== 'boolean' || !item.rationale?.reasons || !item.rationale.evidence_references || !Array.isArray(item.evidence_snapshot?.manual_observations))) throw new Error('评估历史响应不完整')
    for (const assessment of result.items) {
      if (assessment.model_method && !['weighted-value-effort', 'rice'].includes(assessment.model_method)) throw new Error('不支持的评估模型方法')
      if (assessment.model_method !== 'rice') continue
      const observation = assessment.evidence_snapshot.reach_observation
      if (assessment.value_score !== null || (assessment.rice_impact != null && !['0.25', '0.50', '1.00', '2.00', '3.00'].includes(assessment.rice_impact))) throw new Error('RICE 评估字段无效')
      if (observation && (observation.biz_id !== assessment.reach_observation_biz_id || observation.product_code !== code.value || observation.item_biz_id !== itemId.value || observation.model_version !== assessment.model_version || !Number.isSafeInteger(observation.reach) || observation.reach < 0 || !['unique_users', 'unique_customer_organizations'].includes(observation.reach_unit))) throw new Error('Reach 历史快照身份不一致')
      if (!observation && (assessment.reach_observation_biz_id || assessment.priority_score !== null)) throw new Error('RICE 评估缺少观测快照')
    }
    return result
  }
})
const { data: permissions, status: permissionStatus } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles/permissions`, { server: false })
const canAssess = computed(() => status.value === 'success' && data.value?.cycle_status === 'open' && permissionStatus.value === 'success' && permissions.value?.code === 0 && permissions.value.data.product_code === code.value && permissions.value.data.status === 'active' && permissions.value.data.assess)
const alert = useApiErrorAlert(error, { fallbackTitle: '评估历史加载失败' })
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6">
    <UButton
      :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/items`"
      color="neutral"
      variant="ghost"
      icon="i-lucide-arrow-left"
    >
      返回周期候选
    </UButton>
    <p class="text-sm text-muted">
      按记录时间倒序展示冻结的评估。当前引用可能已过期；分数不代表决定顺序或交付承诺。
    </p>
    <UButton
      color="neutral"
      variant="outline"
      :loading="status === 'pending'"
      @click="refresh()"
    >
      刷新评估历史
    </UButton>
    <UButton v-if="canAssess" :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/items/${itemId}/assess`" icon="i-lucide-plus">
      新增评估
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在加载评估历史…
    </p>
    <template v-if="status === 'success'">
      <CommonEmptyState
        v-if="!data?.items.length"
        icon="i-lucide-history"
        title="暂无评估记录"
        description="已有规划事项和候选关联不自动生成评分。"
      />
      <article v-for="assessment in data?.items || []" :key="assessment.id" class="min-w-0 space-y-4 rounded-lg border border-default p-4">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="font-semibold">
            评估记录 #{{ assessment.id }}
          </h2>
          <UBadge v-if="assessment.is_current" variant="subtle">
            当前引用
          </UBadge>
          <UBadge v-if="assessment.stale" color="warning" variant="subtle">
            已过期，需复评
          </UBadge>
          <UBadge v-if="assessment.priority_score === null" color="neutral" variant="subtle">
            待评估
          </UBadge>
        </div>
        <p class="break-words text-sm text-muted">
          评估人：{{ assessment.assessed_by }} · 时间：{{ assessment.assessed_at }}（UTC）
        </p>
        <p class="whitespace-pre-wrap break-words text-sm">
          {{ assessment.evidence_snapshot.scope_summary }}
        </p>
        <div class="flex flex-wrap gap-x-8 gap-y-2">
          <p v-if="assessment.model_method !== 'rice'">
            价值分：{{ assessment.value_score ?? '待评估' }}
          </p>
          <p>{{ assessment.model_method === 'rice' ? 'RICE 人日分' : '推荐分' }}：{{ assessment.priority_score ?? '待评估' }}</p>
        </div>
        <dl class="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <div v-for="(label, dimension) in (assessment.model_method === 'rice' ? riceLabels : labels)" :key="dimension" class="min-w-0 space-y-1">
            <dt class="font-medium">
              {{ label }}：{{ dimensionValue(assessment, dimension) ?? '未知' }}
            </dt>
            <dd class="whitespace-pre-wrap break-words text-sm">
              {{ assessment.rationale.reasons[dimension] || '尚无依据' }}
            </dd>
            <dd class="break-words text-xs text-muted">
              证据：{{ assessment.rationale.evidence_references[dimension]?.join('、') || '未关联' }}
            </dd>
          </div>
        </dl>
        <p class="break-words text-sm text-muted">
          投入确认者：{{ assessment.estimated_by ?? '尚未确认' }} · 模型：{{ assessment.model_version }} · 范围版本 {{ assessment.scope_revision }} / 证据版本 {{ assessment.evidence_revision }}
        </p>
        <div v-if="assessment.model_method === 'rice'" class="space-y-2 rounded-lg border border-default p-3">
          <template v-if="assessment.evidence_snapshot.reach_observation">
            <p class="break-words">
              Reach：{{ assessment.evidence_snapshot.reach_observation.reach }}
              {{ assessment.evidence_snapshot.reach_observation.reach_unit === 'unique_users' ? '去重用户' : '去重客户企业' }}
            </p>
            <p>统计窗口：{{ assessment.evidence_snapshot.reach_observation.reach_starts_on }} 至 {{ assessment.evidence_snapshot.reach_observation.reach_ends_on }}</p>
            <p class="whitespace-pre-wrap break-words">
              当时来源：{{ assessment.evidence_snapshot.reach_observation.source_reference }}
            </p>
            <p class="whitespace-pre-wrap break-words">
              取数方法：{{ assessment.evidence_snapshot.reach_observation.methodology }}
            </p>
            <p class="break-all text-xs text-muted">
              观测引用：{{ assessment.reach_observation_biz_id }}
            </p>
          </template>
          <p v-else class="text-sm text-muted">
            本次未引用 Reach 观测，数量保持未知。
          </p>
          <UButton :to="'/products/' + encodeURIComponent(code) + '/planning-items/' + itemId + '/reach'" color="neutral" variant="link">
            查看事项 Reach 观测历史
          </UButton>
        </div>
        <details class="min-w-0">
          <summary class="cursor-pointer font-medium">
            查看本次证据（{{ assessment.evidence_snapshot.manual_observations.length }} 条）
          </summary>
          <div v-for="evidence in assessment.evidence_snapshot.manual_observations" :key="evidence.key" class="mt-3 space-y-1 border-t border-default pt-3">
            <p class="break-words text-sm font-medium">
              {{ evidence.key }} · {{ evidence.observed_on }} · {{ evidence.kind === 'fact' ? '人工记录事实' : '待验证假设' }} · {{ polarity[evidence.polarity] }}
            </p>
            <p class="whitespace-pre-wrap break-words text-sm">
              {{ evidence.summary }}
            </p>
          </div>
        </details>
      </article>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span class="text-sm text-muted">共 {{ data?.total || 0 }} 条评估</span>
        <UPagination
          v-model:page="page"
          :total="data?.total || 0"
          :items-per-page="pageSize"
          :sibling-count="0"
        />
      </div>
    </template>
  </div>
</template>
