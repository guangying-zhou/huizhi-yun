<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

type View = { biz_id: string, product_code: string, owner_uid: string, revision: number, definition: { title: string, audience: string, visibility: string, cycle_biz_id: string, year: number, quarter: number, unscheduled: boolean } }
type Item = { biz_id: string, title: string, scope_summary: string, lifecycle: string, selection_status: string, roadmap_bucket: string, decision_rank: number, starts_on: string | null, ends_on: string | null }
type Applied = { view: View, roadmap: { cycle_biz_id: string, items: Item[], total: number, page: number, pageSize: number, workspace_revision: number } }
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '高级规划 · 周期路线图', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const base = computed(() => `/api/v1/products/${encodeURIComponent(code.value)}/roadmaps/views`)
const contextRefresh = ref(0)
const page = ref(1), itemPage = ref(1), selected = ref('')
const editing = ref(false)
const deleting = ref(false), deleteError = ref<Error | null>(null)
const deleteAlert = useApiErrorAlert(deleteError, { fallbackTitle: '删除视图失败' })
const { confirm } = useConfirm()
const toast = useToast()
const { data: permission, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, actor_uid: string, revision: number, status: string, edit: boolean } }>(() => base.value + '/permissions', { server: false })
const canManage = (view: View) => permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && (view.definition.visibility === 'personal' ? view.owner_uid === permission.value.data.actor_uid : permission.value.data.edit)
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '管理权限加载失败' })
const deleteRetries = new Map<string, { key: string, body: { expectedRevision: number, expectedViewRevision: number } }>()
async function remove(view: View) {
  if (deleting.value || editing.value || !canManage(view)) return
  deleting.value = true
  deleteError.value = null
  try {
    let deleteRetry = deleteRetries.get(view.biz_id)
    if (!deleteRetry) {
      const response = await $fetch<{ code: number, data: View & { workspace_revision: number } }, string>(`${base.value}/${view.biz_id}`, { timeout: 15000 })
      const current = response.data
      if (response.code !== 0 || current?.biz_id !== view.biz_id || current.product_code !== code.value || !Number.isSafeInteger(current.revision) || current.revision < 1 || !Number.isSafeInteger(current.workspace_revision) || current.workspace_revision < 1) throw new Error('当前视图修订不完整，请刷新')
      deleteRetry = { key: crypto.randomUUID(), body: { expectedRevision: current.workspace_revision, expectedViewRevision: current.revision } }
    }
    if (!(await confirm({ title: '删除保存视图', message: `删除“${view.definition.title}”的展示配置。${view.definition.visibility === 'product' ? '产品用户将无法再应用此共享视图。' : ''}规划事项、周期和路线图承诺不受影响。`, tone: 'warning', confirmLabel: '删除视图' }))) return
    deleteRetries.set(view.biz_id, deleteRetry)
    const response = await $fetch<{ code: number, data: { receipt_id: number, value: { biz_id: string, product_code: string, deleted: boolean, revision: number, workspace_revision: number } } }, string>(`${base.value}/${view.biz_id}`, { method: 'DELETE', body: deleteRetry.body, headers: { 'Idempotency-Key': deleteRetry.key }, timeout: 15000 })
    const result = response.data?.value
    if (response.code !== 0 || !Number.isSafeInteger(response.data?.receipt_id) || response.data.receipt_id < 1 || result?.biz_id !== view.biz_id || result.product_code !== code.value || result.deleted !== true || result.revision !== deleteRetry.body.expectedViewRevision + 1 || result.workspace_revision !== deleteRetry.body.expectedRevision + 1) throw new Error('删除回执不完整，请重试')
    deleteRetries.delete(view.biz_id)
    if (selected.value === view.biz_id) selected.value = ''
    page.value = 1
    toast.add({ title: '保存视图已删除', color: 'success' })
    // The mutation is confirmed. A list refresh failure belongs to the list alert.
    await refresh().catch(() => {
      toast.add({ title: '视图已删除，列表刷新失败，请重新刷新列表', color: 'warning' })
    })
  } catch (cause) {
    deleteError.value = cause instanceof Error ? cause : new Error('删除失败')
  } finally { deleting.value = false }
}
onBeforeRouteLeave(() => !deleting.value && !editing.value)
onBeforeRouteUpdate(() => !deleting.value && !editing.value)
const audiences: Record<string, string> = { planning: '规划讨论', delivery: '交付协调', stakeholder: '干系人概览' }
const lifecycle: Record<string, string> = { proposed: '待规划', in_delivery: '交付中', delivered: '已交付', cancelled: '已取消', merged: '已合并' }
const selections: Record<string, string> = { candidate: '候选', selected: '已选入', deferred: '暂缓' }
const buckets: Record<string, string> = { now: '近期', next: '下一阶段', later: '后续探索' }
const validView = (view: View) => view && view.product_code === code.value && !!view.biz_id && !!view.definition?.title && Object.hasOwn(audiences, view.definition.audience) && ['personal', 'product'].includes(view.definition.visibility)
const { data, status, error, refresh } = await useFetch(() => base.value + '/list', {
  server: false, query: { page, pageSize: 20 },
  transform: (response: { code: number, data: { items: View[], total: number, page: number, pageSize: number, product_code: string } }) => {
    const value = response.data
    if (response.code !== 0 || !value || value.product_code !== code.value || !Array.isArray(value.items) || value.items.some(view => !validView(view)) || !Number.isSafeInteger(value.total) || value.total < 0 || value.page !== page.value || value.pageSize !== 20 || value.items.length > 20) throw new Error('保存视图列表不完整')
    return value
  }
})
const { data: applied, status: applyStatus, error: applyError, refresh: apply } = await useAsyncData(() => `saved-roadmap:${code.value}:${selected.value}:${itemPage.value}`, async () => {
  if (!selected.value) return null
  const response = await $fetch<{ code: number, data: Applied }, string>(`${base.value}/${selected.value}/apply`, { query: { page: itemPage.value, pageSize: 20 }, timeout: 15000 })
  const value = response.data
  if (response.code !== 0 || !value || !validView(value.view) || value.view.biz_id !== selected.value || value.roadmap.cycle_biz_id !== value.view.definition.cycle_biz_id || !Array.isArray(value.roadmap.items) || value.roadmap.items.some(item => !item.biz_id || !item.title || !Object.hasOwn(buckets, item.roadmap_bucket)) || !Number.isSafeInteger(value.roadmap.total) || value.roadmap.total < 0 || value.roadmap.page !== itemPage.value || value.roadmap.pageSize !== 20 || value.roadmap.items.length > 20) throw new Error('应用视图响应不完整')
  return value
}, { server: false })
watch(applied, () => {
  contextRefresh.value++
})
const alert = useApiErrorAlert(error, { fallbackTitle: '保存视图加载失败' })
const applyAlert = useApiErrorAlert(applyError, { fallbackTitle: '视图应用失败' })
const columns: TableColumn<View>[] = [{ id: 'name', header: '名称 / 受众' }, { id: 'scope', header: '可见性' }, { id: 'action', header: '操作' }]
function choose(view: View) {
  itemPage.value = 1
  selected.value = view.biz_id
}
watch(code, () => {
  page.value = 1
  itemPage.value = 1
  selected.value = ''
  deleteRetries.clear()
  deleteError.value = null
})
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6">
    <ProductsVersionTools :product-code="code" />
    <UButton :to="`/products/${encodeURIComponent(code)}/cycles`" color="neutral" variant="ghost">
      管理规划周期
    </UButton>
    <p class="text-sm text-muted">
      个人视图仅本人可见；共享视图供有权限的产品用户使用。应用视图会重新校验当前访问权限。
    </p>
    <UButton
      color="neutral"
      variant="outline"
      :loading="status === 'pending'"
      :disabled="editing || deleting"
      @click="refresh()"
    >
      刷新视图列表
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <UButton
      v-if="permissionError"
      color="neutral"
      variant="outline"
      :disabled="editing || deleting"
      @click="refreshPermission()"
    >
      重新读取管理权限
    </UButton>
    <UAlert v-if="deleteAlert" v-bind="deleteAlert" />
    <UTable :data="data?.items ?? []" :columns="columns" :loading="status === 'pending'">
      <template #name-cell="{ row }">
        <p class="break-words">
          {{ row.original.definition.title }}
        </p><p class="text-sm text-muted">
          {{ audiences[row.original.definition.audience] }} · {{ row.original.definition.year }} Q{{ row.original.definition.quarter }}{{ row.original.definition.unscheduled ? ' · 未排期' : '' }}
        </p>
      </template>
      <template #scope-cell="{ row }">
        {{ row.original.definition.visibility === 'personal' ? '个人' : '产品共享' }}
      </template>
      <template #action-cell="{ row }">
        <UButton size="sm" :disabled="editing || deleting || applyStatus === 'pending'" @click="choose(row.original)">
          应用视图
        </UButton>
        <ProductsEditRoadmapView
          v-if="canManage(row.original)"
          :product-code="code"
          :view-id="row.original.biz_id"
          :disabled="deleting || editing"
          @busy="editing = $event"
          @saved="refresh(); selected === row.original.biz_id && apply()"
        />
        <UButton
          v-if="canManage(row.original)"
          size="sm"
          color="error"
          variant="ghost"
          :disabled="editing || deleting"
          @click="remove(row.original)"
        >
          删除
        </UButton>
      </template>
      <template #empty>
        <CommonEmptyState icon="i-lucide-panels-top-left" title="暂无保存视图" description="当前没有可访问的视图。" />
      </template>
    </UTable>
    <div v-if="data" class="flex flex-wrap items-center gap-3">
      <span>共 {{ data.total }} 个视图</span><UPagination
        v-model:page="page"
        :disabled="editing || deleting"
        :items-per-page="20"
        :total="data.total"
      />
    </div>
    <UAlert v-if="applyAlert" v-bind="applyAlert" />
    <UButton
      v-if="selected"
      color="neutral"
      variant="outline"
      :loading="applyStatus === 'pending'"
      :disabled="editing || deleting"
      @click="apply()"
    >
      重新应用当前视图
    </UButton>
    <section v-if="applied && !applyError" v-show="applyStatus === 'success'" class="space-y-3">
      <h2 class="break-words text-lg font-semibold">
        {{ applied.view.definition.title }} · {{ audiences[applied.view.definition.audience] }}
      </h2>
      <p class="text-sm text-muted">
        当前规划视图，不构成发布承诺。{{ applied.view.definition.audience === 'delivery' ? '时间窗口用于协调，具体交付以承诺与版本范围为准。' : '各视图保持相同决定队列，展示方式不改变正式顺序。' }}
      </p>
      <ProductsRoadmapCycleGoal
        :key="applied.view.definition.cycle_biz_id"
        :product-code="code"
        :cycle-id="applied.view.definition.cycle_biz_id"
        :refresh-token="contextRefresh"
      />
      <CommonEmptyState
        v-if="!applied.roadmap.items.length"
        icon="i-lucide-calendar-range"
        title="本页暂无规划事项"
        description="可调整页码或返回周期查看当前规划。"
      />
      <article v-for="item in applied.roadmap.items" :key="item.biz_id" class="space-y-2 rounded-lg border border-default p-3">
        <h3 class="break-words font-medium">
          {{ item.title }}
        </h3>
        <p>{{ buckets[item.roadmap_bucket] }} · {{ lifecycle[item.lifecycle] || '状态待核对' }} · {{ selections[item.selection_status] || '决定待核对' }}</p>
        <p v-if="applied.view.definition.audience === 'planning'" class="whitespace-pre-wrap break-words text-sm">
          {{ item.scope_summary }} · 决定顺序 {{ item.decision_rank }}
        </p>
        <p v-if="applied.view.definition.audience !== 'stakeholder'" class="text-sm">
          {{ item.starts_on || '未排期' }} — {{ item.ends_on || '未排期' }}
        </p>
        <ProductsPlanningItemObjectives
          :key="`objectives:${selected}:${item.biz_id}`"
          :product-code="code"
          :item-id="item.biz_id"
          :refresh-token="contextRefresh"
        />
        <ProductsRoadmapCommitmentSummary
          v-if="applied.view.definition.audience !== 'planning'"
          :key="`${selected}:${item.biz_id}`"
          :product-code="code"
          :item-id="item.biz_id"
          :refresh-token="contextRefresh"
        />
        <UButton :to="`/products/${encodeURIComponent(code)}/planning-items/${item.biz_id}`" variant="link">
          查看事项
        </UButton>
      </article>
      <div class="flex flex-wrap items-center gap-3">
        <span>共 {{ applied.roadmap.total }} 项</span><UPagination
          v-model:page="itemPage"
          :disabled="editing || deleting"
          :items-per-page="20"
          :total="applied.roadmap.total"
        />
      </div>
    </section>
  </div>
</template>
