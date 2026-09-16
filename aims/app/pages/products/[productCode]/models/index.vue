<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

type Model = { biz_id: string, product_code: string, version: string, title: string, method: string, configuration: { weights?: Record<string, number>, reach_unit?: string, reach_definition?: string, reach_starts_on?: string, reach_ends_on?: string, source_definition?: string, effort_unit?: string }, reason: string, created_by: string, created_at: string }
type ModelPage = { items: Model[], total: number, page: number, pageSize: number, product_code: string, workspace_revision: number }
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '高级规划 · 评分模型', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const base = computed(() => '/api/v1/products/' + encodeURIComponent(code.value) + '/priority-models')
const page = ref(1)
const pageSize = 20
const { data, status, error, refresh } = await useFetch(() => base.value + '/list', {
  server: false, query: { page, pageSize },
  transform: (response: { code: number, data: ModelPage }) => {
    const result = response.data
    if (response.code !== 0 || !result || result.product_code !== code.value || !Number.isSafeInteger(result.total) || result.total < 0 || result.page !== page.value || result.pageSize !== pageSize || !Number.isSafeInteger(result.workspace_revision) || result.workspace_revision < 1 || !Array.isArray(result.items) || result.items.length > pageSize || result.items.some(item => item.product_code !== code.value || !item.biz_id || !item.version || !item.title || !item.configuration || !item.method || typeof item.created_at !== 'string' || typeof item.reason !== 'string')) throw new Error('模型列表响应不完整')
    return result
  }
})
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermissions } = await useFetch<{ code: number, data: { product_code: string, status: string, admin: boolean } }>(() => base.value + '/permissions', { server: false })
const canCreate = computed(() => permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.admin === true)
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '模型权限加载失败' })
const alert = useApiErrorAlert(error, { fallbackTitle: '评分模型加载失败' })
const columns: TableColumn<Model>[] = [{ accessorKey: 'title', header: '模型名称' }, { accessorKey: 'version', header: '版本' }, { accessorKey: 'method', header: '计算方法' }, { accessorKey: 'reason', header: '发布原因' }, { accessorKey: 'created_at', header: '发布时间' }]
const selected = ref<Model | null>(null)
const open = computed({ get: () => selected.value !== null, set: (value: boolean) => {
  if (!value) selected.value = null
} })
const weightLabels: Record<string, string> = { strategic: '战略一致性', user_value: '用户价值', business: '商业价值', risk: '风险降低' }
watch(code, () => {
  page.value = 1
  selected.value = null
})
watch(page, () => {
  selected.value = null
})
async function reload() {
  selected.value = null
  await Promise.all([refresh(), refreshPermissions()])
}
</script>

<template>
  <div class="min-w-0 space-y-4 p-4 sm:p-6">
    <UButton
      :to="`/products/${encodeURIComponent(code)}/settings`"
      icon="i-lucide-arrow-left"
      color="neutral"
      variant="ghost"
    >
      返回设置
    </UButton>
    <h1 class="text-lg font-semibold">
      高级规划 · 评分模型
    </h1>
    <p class="text-sm text-muted">
      模型发布后保留为不可变版本。规划周期选用时冻结规则，新版本不会改变历史评估。
    </p>
    <UAlert color="info" title="内置默认模型" description="战略一致性 30%、用户价值 30%、商业价值 20%、风险降低 20%。优先分结合置信度与预计投入人日计算；内置模型不计入下面的版本总数。" />
    <UButton
      color="neutral"
      variant="outline"
      :loading="status === 'pending'"
      @click="reload"
    >
      刷新模型
    </UButton>
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <UButton v-if="canCreate" :to="'/products/' + encodeURIComponent(code) + '/models/new'" icon="i-lucide-plus">
      发布模型版本
    </UButton>
    <UButton
      v-if="canCreate"
      :to="'/products/' + encodeURIComponent(code) + '/models/rice-new'"
      color="neutral"
      variant="outline"
    >
      发布 RICE 模型定义
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <div class="min-w-0 overflow-x-auto rounded-lg border border-default">
      <UTable :data="status === 'success' ? data?.items || [] : []" :columns="columns" :loading="status === 'pending'">
        <template #title-cell="{ row }">
          <UButton
            color="neutral"
            variant="link"
            class="max-w-72 whitespace-normal text-left"
            @click="selected = row.original"
          >
            {{ row.original.title }}
          </UButton>
        </template>
        <template #method-cell="{ row }">
          {{ row.original.method === 'weighted-value-effort' ? '加权价值 / 投入' : row.original.method === 'rice' ? 'RICE（暂不支持选用）' : '暂不支持的方法' }}
        </template>
        <template #reason-cell="{ row }">
          <span class="block max-w-80 whitespace-pre-wrap break-words">{{ row.original.reason }}</span>
        </template>
        <template #created_at-cell="{ row }">
          {{ row.original.created_at.replace('T', ' ').replace('Z', ' UTC') }}
        </template>
        <template #empty>
          <CommonEmptyState icon="i-lucide-sliders-horizontal" :title="status === 'error' ? '模型加载失败' : status === 'pending' ? '正在加载模型' : '尚未发布自定义模型'" description="仍可使用内置默认模型规划与评估。" />
        </template>
      </UTable>
    </div>
    <div v-if="status === 'success'" class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-muted">共 {{ data?.total || 0 }} 个自定义模型版本</span>
      <UPagination
        v-model:page="page"
        :total="data?.total || 0"
        :items-per-page="pageSize"
        :sibling-count="0"
        show-edges
      />
    </div>
    <UModal v-model:open="open" :title="selected?.title || '模型详情'" description="此版本的已发布规则与发布原因">
      <template #body>
        <div v-if="selected" class="space-y-3 break-words">
          <p>版本：{{ selected.version }}</p>
          <dl v-if="selected.method === 'weighted-value-effort'" class="space-y-2">
            <div v-for="(label, key) in weightLabels" :key="key" class="flex justify-between gap-3">
              <dt>{{ label }}</dt>
              <dd>{{ selected.configuration.weights?.[key] === undefined ? '未提供' : selected.configuration.weights[key] + '%' }}</dd>
            </div>
          </dl>
          <dl v-if="selected.method === 'rice'" class="space-y-3">
            <div>
              <dt class="font-medium">
                Reach 去重对象
              </dt>
              <dd>{{ selected.configuration.reach_unit === 'unique_users' ? '去重用户数' : selected.configuration.reach_unit === 'unique_customer_organizations' ? '去重客户企业数' : '未提供支持的口径' }}</dd>
            </div>
            <div>
              <dt class="font-medium">
                统计窗口
              </dt>
              <dd>{{ selected.configuration.reach_starts_on || '未提供' }} 至 {{ selected.configuration.reach_ends_on || '未提供' }}</dd>
            </div>
            <div>
              <dt class="font-medium">
                去重与对象范围定义
              </dt>
              <dd class="whitespace-pre-wrap">
                {{ selected.configuration.reach_definition || '未提供' }}
              </dd>
            </div>
            <div>
              <dt class="font-medium">
                数据来源定义
              </dt>
              <dd class="whitespace-pre-wrap">
                {{ selected.configuration.source_definition || '未提供' }}
              </dd>
            </div>
            <div>
              <dt class="font-medium">
                投入单位
              </dt>
              <dd>{{ selected.configuration.effort_unit === 'person_day' ? '人日' : '未提供支持的单位' }}</dd>
            </div>
          </dl>
          <UAlert
            v-if="selected.method === 'rice'"
            color="info"
            title="RICE 模型定义"
            description="发布定义不代表数据已经验证。当前尚不支持周期选用，不能用来源说明替代 Reach 观测证据。"
          />
          <p class="whitespace-pre-wrap">
            发布原因：{{ selected.reason }}
          </p>
          <p class="text-sm text-muted">
            发布时间：{{ selected.created_at.replace('T', ' ').replace('Z', ' UTC') }}
          </p>
        </div>
      </template>
    </UModal>
  </div>
</template>
