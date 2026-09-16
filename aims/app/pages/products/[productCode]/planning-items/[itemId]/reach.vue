<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

type Observation = { biz_id: string, product_code: string, item_biz_id: string, model_version: string, reach: number, reach_unit: string, reach_starts_on: string, reach_ends_on: string, reach_definition: string, source_definition: string, source_reference: string, methodology: string, recorded_by: string, recorded_at: string, scope_revision: number, evidence_revision: number }
type Row = { observation: Observation, stale: boolean, item_revision: number, workspace_revision: number }
type Page = { items: Row[], total: number, page: number, pageSize: number, product_code: string, item_biz_id: string, workspace_revision: number, item_revision: number }
definePageMeta({ layoutHeader: true, layoutHeaderTitle: 'Reach 观测历史', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.itemId || ''))
const page = ref(1)
const selected = ref<Row | null>(null)
const open = computed({ get: () => selected.value !== null, set: (value: boolean) => {
  if (!value) selected.value = null
} })
const { data, status, error, refresh } = await useFetch(() => '/api/v1/products/' + encodeURIComponent(code.value) + '/reach-observations/items/' + encodeURIComponent(id.value), {
  server: false, query: { page, pageSize: 20 },
  transform: (response: { code: number, data: Page }) => {
    const result = response.data
    if (response.code !== 0 || !result || result.product_code !== code.value || result.item_biz_id !== id.value || !Number.isSafeInteger(result.total) || result.total < 0 || result.page !== page.value || result.pageSize !== 20 || !Array.isArray(result.items) || result.items.length > 20 || result.items.some(row => !row.observation || row.observation.product_code !== code.value || row.observation.item_biz_id !== id.value || !row.observation.biz_id || !Number.isSafeInteger(row.observation.reach) || row.observation.reach < 0 || row.observation.reach > 1000000000 || typeof row.stale !== 'boolean' || typeof row.observation.recorded_at !== 'string' || row.item_revision !== result.item_revision || row.workspace_revision !== result.workspace_revision)) throw new Error('Reach 观测列表响应不完整')
    return result
  }
})
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, status: string, assess: boolean } }>(() => '/api/v1/products/' + encodeURIComponent(code.value) + '/reach-observations/permissions', { server: false })
const canRecord = computed(() => permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.assess === true)
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '观测权限加载失败' })
const alert = useApiErrorAlert(error, { fallbackTitle: 'Reach 观测加载失败' })
const columns: TableColumn<Row>[] = [{ id: 'reach', header: 'Reach' }, { id: 'model', header: '模型版本' }, { id: 'window', header: '统计窗口' }, { accessorKey: 'stale', header: '范围与证据状态' }, { id: 'recorded', header: '记录时间' }]
const unit = (value: string) => value === 'unique_users' ? '去重用户' : value === 'unique_customer_organizations' ? '去重客户企业' : '未知口径'
watch([code, id], () => {
  page.value = 1
  selected.value = null
})
watch(page, () => {
  selected.value = null
})
async function reload() {
  selected.value = null
  await Promise.all([refresh(), refreshPermission()])
}
</script>

<template>
  <div class="min-w-0 space-y-4 p-4 sm:p-6">
    <UButton :to="'/products/' + encodeURIComponent(code) + '/planning-items/' + encodeURIComponent(id)" color="neutral" variant="ghost">
      返回规划事项
    </UButton>
    <p class="text-sm text-muted">
      观测按模型的去重对象与统计窗口记录。范围或证据修订变化后，历史观测保留并标为已过期；记录不代表外部来源已自动验证。
    </p>
    <UButton
      color="neutral"
      variant="outline"
      :loading="status === 'pending'"
      @click="reload"
    >
      刷新观测
    </UButton>
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <UButton v-if="canRecord" :to="'/products/' + encodeURIComponent(code) + '/planning-items/' + encodeURIComponent(id) + '/reach-new'" icon="i-lucide-plus">
      记录 Reach 观测
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <div class="min-w-0 overflow-x-auto rounded-lg border border-default">
      <UTable :data="status === 'success' ? data?.items || [] : []" :columns="columns" :loading="status === 'pending'">
        <template #reach-cell="{ row }">
          <UButton color="neutral" variant="link" @click="selected = row.original">
            {{ row.original.observation.reach }} {{ unit(row.original.observation.reach_unit) }}
          </UButton>
        </template>
        <template #model-cell="{ row }">
          {{ row.original.observation.model_version }}
        </template>
        <template #window-cell="{ row }">
          {{ row.original.observation.reach_starts_on }} 至 {{ row.original.observation.reach_ends_on }}
        </template>
        <template #stale-cell="{ row }">
          <UBadge :color="row.original.stale ? 'warning' : 'neutral'" variant="subtle">
            {{ row.original.stale ? '已过期' : '与当前修订一致' }}
          </UBadge>
        </template>
        <template #recorded-cell="{ row }">
          {{ row.original.observation.recorded_at.replace('T', ' ').replace('Z', ' UTC') }}
        </template>
        <template #empty>
          <CommonEmptyState icon="i-lucide-chart-no-axes-combined" :title="status === 'error' ? '观测加载失败' : status === 'pending' ? '正在加载观测' : '尚无 Reach 观测'" description="真实记录去重对象数量及可追溯来源，未知数量不应填写为零。" />
        </template>
      </UTable>
    </div>
    <div v-if="status === 'success'" class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-muted">共 {{ data?.total || 0 }} 条观测</span>
      <UPagination
        v-model:page="page"
        :total="data?.total || 0"
        :items-per-page="20"
        :sibling-count="0"
        show-edges
      />
    </div>
    <UModal v-model:open="open" title="Reach 观测详情" description="不可变的统计口径、来源与记录信息">
      <template #body>
        <dl v-if="selected" class="space-y-3 break-words">
          <div>
            <dt class="font-medium">
              观测数量与模型
            </dt><dd>{{ selected.observation.reach }} {{ unit(selected.observation.reach_unit) }} · {{ selected.observation.model_version }}</dd>
          </div>
          <div>
            <dt class="font-medium">
              统计窗口
            </dt><dd>{{ selected.observation.reach_starts_on }} 至 {{ selected.observation.reach_ends_on }}</dd>
          </div>
          <div>
            <dt class="font-medium">
              去重与范围定义
            </dt><dd class="whitespace-pre-wrap">
              {{ selected.observation.reach_definition }}
            </dd>
          </div>
          <div>
            <dt class="font-medium">
              数据来源定义
            </dt><dd class="whitespace-pre-wrap">
              {{ selected.observation.source_definition }}
            </dd>
          </div>
          <div>
            <dt class="font-medium">
              来源引用
            </dt><dd class="whitespace-pre-wrap">
              {{ selected.observation.source_reference }}
            </dd>
          </div>
          <div>
            <dt class="font-medium">
              取数方法
            </dt><dd class="whitespace-pre-wrap">
              {{ selected.observation.methodology }}
            </dd>
          </div>
          <div>
            <dt class="font-medium">
              记录人
            </dt><dd>{{ selected.observation.recorded_by }}</dd>
          </div>
          <div>
            <dt class="font-medium">
              快照修订
            </dt><dd>范围 {{ selected.observation.scope_revision }} / 证据 {{ selected.observation.evidence_revision }}</dd>
          </div>
        </dl>
      </template>
    </UModal>
  </div>
</template>
