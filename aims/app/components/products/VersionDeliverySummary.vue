<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const props = defineProps<{ productCode: string, versionId: number }>()
const code = computed(() => props.productCode)
type Totals = { target_count: number, incomplete_target_count: number, open_defect_count: number, total_weight: number, completed_weight: number, no_execution_plan: boolean }
type Project = Totals & { project_id: number }
type Coordination = Totals & { product_code: string, version_id: number, workspace_revision: number, defect_coverage: string, projects: Project[], total: number, restricted_project_count: number, page: number, pageSize: number }
const page = ref(1)
const keys = ['target_count', 'incomplete_target_count', 'open_defect_count', 'total_weight', 'completed_weight'] as const
const validTotals = (value: Totals) => value && keys.every(key => Number.isSafeInteger(value[key]) && value[key] >= 0) && value.incomplete_target_count <= value.target_count && value.completed_weight <= value.total_weight && value.no_execution_plan === (value.total_weight === 0)
const { data, status, error, refresh } = await useAsyncData(() => `version-delivery:${code.value}:${props.versionId}`, async () => {
  const productCode = code.value, versionId = props.versionId, requestedPage = page.value
  const response = await $fetch<{ code: number, data: Coordination }, string>(`/api/v1/products/${encodeURIComponent(productCode)}/roadmaps/execution-coordination`, { query: { versionId, page: requestedPage, pageSize: 20 }, timeout: 15000 })
  const value = response.data
  if (response.code !== 0 || !value || value.product_code !== productCode || value.version_id !== versionId || !Number.isSafeInteger(value.workspace_revision) || value.workspace_revision < 1 || value.defect_coverage !== 'linked-descendants-only' || !validTotals(value) || ![value.total, value.restricted_project_count].every(n => Number.isSafeInteger(n) && n >= 0) || value.page !== requestedPage || value.pageSize !== 20 || !Array.isArray(value.projects) || value.projects.length !== Math.min(20, Math.max(0, value.total - (requestedPage - 1) * 20)) || value.projects.some((project, index) => !validTotals(project) || !Number.isSafeInteger(project.project_id) || project.project_id < 1 || (index > 0 && project.project_id <= value.projects[index - 1]!.project_id)) || keys.some(key => value.projects.reduce((sum, project) => sum + BigInt(project[key]), 0n) > BigInt(value[key]))) throw new Error('协调汇总响应不完整')
  return value
}, { server: false, watch: [page] })
const busy = computed(() => status.value === 'pending')
const alert = useApiErrorAlert(error, { fallbackTitle: '协调汇总读取失败' })
const columns: TableColumn<Project>[] = [{ id: 'project', header: '执行项目' }, { accessorKey: 'target_count', header: '目标数' }, { accessorKey: 'incomplete_target_count', header: '未完成目标' }, { accessorKey: 'open_defect_count', header: '未关闭关联缺陷' }, { id: 'weight', header: '完成权重 / 总权重' }]
watch([code, () => props.versionId], () => {
  page.value = 1
})
</script>

<template>
  <div class="min-w-0 space-y-4">
    <p class="text-sm text-muted">
      按执行目标权重汇总，权重不代表工时。缺陷仅覆盖关联目标的后代，不代表产品全部缺陷。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <UButton
      :loading="busy"
      color="neutral"
      variant="outline"
      @click="refresh()"
    >
      刷新协调汇总
    </UButton>
    <template v-if="data && status === 'success'">
      <div class="grid gap-3 sm:grid-cols-3">
        <UCard>
          <p class="text-sm text-muted">
            版本整体完成权重
          </p><p class="text-xl font-semibold">
            {{ data.no_execution_plan ? '无执行计划' : `${data.completed_weight} / ${data.total_weight}` }}
          </p>
        </UCard>
        <UCard>
          <p class="text-sm text-muted">
            未完成目标 / 全部目标
          </p><p class="text-xl font-semibold">
            {{ data.incomplete_target_count }} / {{ data.target_count }}
          </p>
        </UCard>
        <UCard>
          <p class="text-sm text-muted">
            未关闭关联缺陷
          </p><p class="text-xl font-semibold">
            {{ data.open_defect_count }}
          </p>
        </UCard>
      </div>
      <UAlert
        v-if="data.restricted_project_count"
        color="warning"
        title="部分项目明细受限"
        :description="`${data.restricted_project_count} 个项目不可查看。上方为版本整体统计，下表仅包含有权查看的项目。`"
      />
      <p class="text-sm text-muted sm:hidden">
        左右滑动查看完整项目统计。
      </p>
      <div class="overflow-x-auto">
        <UTable
          class="min-w-[640px]"
          :data="data.projects"
          :columns="columns"
          :loading="busy"
        >
          <template #project-cell="{ row }">
            <UButton :to="`/projects/${row.original.project_id}/work-items`" variant="link">
              项目 {{ row.original.project_id }}
            </UButton>
          </template>
          <template #weight-cell="{ row }">
            {{ row.original.no_execution_plan ? '无执行计划' : `${row.original.completed_weight} / ${row.original.total_weight}` }}
          </template>
          <template #empty>
            <CommonEmptyState icon="i-lucide-network" :title="data.restricted_project_count ? '本页无可见项目' : '本页暂无执行项目'" :description="data.total ? '可调整页码查看其他项目。' : data.restricted_project_count ? '当前没有可查看的项目明细，上方保留版本整体统计。' : '当前版本尚无关联执行项目。'" />
          </template>
        </UTable>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span>共 {{ data.total }} 个可见项目</span><UPagination
          v-model:page="page"
          :items-per-page="20"
          :total="data.total"
          :disabled="busy"
          :sibling-count="0"
        />
      </div>
    </template>
    <p v-else-if="busy" role="status">
      正在读取协调汇总…
    </p>
  </div>
</template>
