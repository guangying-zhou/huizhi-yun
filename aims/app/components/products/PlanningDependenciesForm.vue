<script setup lang="ts">
import type { ProductPlanningDetail } from '~/types/productPlanning'
import { mergeProductDependencyDraft } from '~/utils/productDependencyDraft'

interface Predecessor { biz_id: string, title: string, lifecycle: string, revision: number }
const props = defineProps<{ productCode: string, item: ProductPlanningDetail, initial: Predecessor[], workspaceRevision: number }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const currentItem = ref({ ...props.item })
const original = ref(props.initial.map(item => ({ ...item })))
const workspaceRevision = ref(props.workspaceRevision)
const refreshed = ref(false)
const selected = ref<Predecessor[]>(props.initial.map(item => ({ ...item })))
const page = ref(1), selectedPage = ref(1), reason = ref(''), impactNote = ref(''), busy = ref(false), error = ref<Error | null>(null)
const { search, debounced, flush, reset } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const base = `/api/v1/products/${encodeURIComponent(props.productCode)}`
const { data, status, error: listError, refresh } = await useFetch(`${base}/planning-items`, {
  server: false, query: computed(() => ({ page: page.value, pageSize: 10, keyword: debounced.value || undefined })),
  transform: (response: { code: number, data: { items: (Predecessor & { product_code: string })[], total: number } }) => {
    if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.items.some(item => item.product_code !== props.productCode || !item.biz_id || !item.title)) throw new Error('候选前置数据不完整')
    return response.data
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '依赖保存失败' })
const listAlert = useApiErrorAlert(listError, { fallbackTitle: '前置候选加载失败' })
const states: Record<string, string> = { proposed: '待规划', in_delivery: '交付中', delivered: '已交付', cancelled: '已取消', merged: '已合并' }
const added = computed(() => selected.value.filter(item => !original.value.some(old => old.biz_id === item.biz_id)))
const removed = computed(() => original.value.filter(item => !selected.value.some(next => next.biz_id === item.biz_id)))
const changed = computed(() => added.value.length + removed.value.length > 0)
const { confirm } = useConfirm()
let retry: { payload: string, key: string } | undefined
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
function add(item: Predecessor) {
  if (busy.value || selected.value.length >= 100 || item.biz_id === props.item.biz_id || ['cancelled', 'merged'].includes(item.lifecycle) || selected.value.some(old => old.biz_id === item.biz_id)) return
  selected.value.push({ ...item })
}
function remove(id: string) {
  if (busy.value) return
  selected.value = selected.value.filter(item => item.biz_id !== id)
  selectedPage.value = Math.min(selectedPage.value, Math.max(1, Math.ceil(selected.value.length / 10)))
}
async function reloadPreservingDraft() {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    const item = await $fetch<{ code: number, data: ProductPlanningDetail }>(`${base}/planning-items/${props.item.biz_id}`, { timeout: 15000 })
    const response = await $fetch<{ code: number, data: { item_biz_id: string, workspace_revision: number, item_revision: number, scope_revision: number, requires_impact_note: boolean, predecessors: Predecessor[] } }>(`${base}/planning-items/${props.item.biz_id}/dependencies`, { timeout: 15000 })
    const latest = response.data
    if (item.code !== 0 || item.data?.biz_id !== props.item.biz_id || item.data.product_code !== props.productCode || !['proposed', 'in_delivery'].includes(item.data.lifecycle)) throw new Error('当前事项已不可编辑，草稿已保留')
    if (response.code !== 0 || latest?.item_biz_id !== props.item.biz_id || latest.item_revision !== item.data.revision || latest.workspace_revision !== item.data.workspace_revision || latest.scope_revision !== item.data.scope_revision || latest.requires_impact_note !== item.data.requires_impact_note || !Array.isArray(latest.predecessors) || latest.predecessors.length > 100) throw new Error('读取期间数据发生变化，请重新读取；草稿已保留')
    for (const revision of [latest.item_revision, latest.workspace_revision, latest.scope_revision]) if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('最新版本无效，草稿已保留')
    if (latest.predecessors.some(entry => !entry.biz_id || !entry.title || !Number.isSafeInteger(entry.revision) || entry.revision < 1)) throw new Error('最新前置信息不完整，草稿已保留')
    const merged = mergeProductDependencyDraft(original.value, selected.value, latest.predecessors)
    original.value = latest.predecessors
    selected.value = merged
    currentItem.value = item.data
    workspaceRevision.value = latest.workspace_revision
    selectedPage.value = 1
    refreshed.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('重新读取失败，草稿已保留')
  } finally { busy.value = false }
}

async function save() {
  if (busy.value || !changed.value) return
  error.value = null
  if (!reason.value.trim() || (currentItem.value.requires_impact_note && !impactNote.value.trim())) {
    error.value = new Error('请填写变更原因；已选入或交付中事项还需填写影响说明')
    return
  }
  const body = { expectedRevision: workspaceRevision.value, expectedItemRevision: currentItem.value.revision, predecessorIds: selected.value.map(item => item.biz_id).sort(), reason: reason.value, impactNote: impactNote.value }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  try {
    if (!(await confirm({ title: '确认修改前置依赖', message: `修改“${currentItem.value.title}”的前置关系：新增 ${added.value.length} 项，移除 ${removed.value.length} 项，保存后共 ${selected.value.length} 项。\n完整增删名单已在页面列出。\n原因：${reason.value}\n原评估将需要复评；现有选择和版本承诺不会自动改写。`, tone: 'warning', confirmLabel: '确认保存依赖' }))) return
    const response = await $fetch<{ code: number }>(`${base}/planning-items/${props.item.biz_id}/dependencies`, { method: 'PUT', body, headers: { 'Idempotency-Key': retry.key }, timeout: 15000 })
    if (response.code !== 0) throw new Error('依赖保存响应不完整，请重试')
    busy.value = false
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('保存失败，已保留编辑内容')
  } finally { busy.value = false }
}
</script>

<template>
  <div class="min-w-0 space-y-4">
    <h1 class="break-words text-xl font-semibold">
      前置依赖：{{ currentItem.title }}
    </h1>
    <p class="text-sm text-muted">
      选择本事项开始前需要完成的规划事项。系统会检查整个产品的循环关系；已交付前置仍可保留溯源。
    </p>
    <UButton
      color="neutral"
      variant="outline"
      :disabled="busy"
      @click="reloadPreservingDraft"
    >
      重新读取并保留草稿
    </UButton>
    <UAlert
      v-if="refreshed"
      color="info"
      title="已合并最新前置关系"
      description="保留您的新增和移除意图，以及其他人新增的关系；变更原因仍保留。请核对完整集合与增删名单，再保存。"
    />
    <section class="space-y-3">
      <h2 class="font-semibold">
        保存后的完整前置集合 · 共 {{ selected.length }} 项（最多 100 项）
      </h2>
      <CommonEmptyState
        v-if="!selected.length"
        icon="i-lucide-git-branch"
        title="当前没有前置事项"
        description="可从下方候选添加；保存空集合会移除原有前置关系。"
      />
      <div v-for="entry in selected.slice((selectedPage - 1) * 10, selectedPage * 10)" :key="entry.biz_id" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-default p-3">
        <p class="min-w-0 break-words text-sm">
          {{ entry.title }} · {{ states[entry.lifecycle] || entry.lifecycle }}
        </p>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="busy"
          :aria-label="`从前置集合移除 ${entry.title}`"
          @click="remove(entry.biz_id)"
        >
          移除
        </UButton>
      </div>
      <UPagination
        v-if="selected.length > 10"
        v-model:page="selectedPage"
        :items-per-page="10"
        :total="selected.length"
        :sibling-count="0"
        :disabled="busy"
      />
    </section>
    <section class="space-y-3">
      <h2 class="font-semibold">
        查找同产品事项
      </h2>
      <form class="flex flex-wrap items-end gap-2" @submit.prevent="flush">
        <UFormField label="搜索前置事项" class="min-w-0 flex-1">
          <UInput v-model="search" class="w-full" :disabled="busy" />
        </UFormField>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          :disabled="busy"
          @click="reset()"
        >
          重置搜索
        </UButton>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          :disabled="busy"
          :loading="status === 'pending'"
          @click="refresh()"
        >
          刷新候选
        </UButton>
      </form>
      <UAlert v-if="listAlert" v-bind="listAlert" />
      <p v-if="status === 'pending'" role="status">
        正在加载前置候选…
      </p>
      <template v-if="status === 'success' && data">
        <div v-for="entry in data.items" :key="entry.biz_id" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-default p-3">
          <p class="min-w-0 break-words text-sm">
            {{ entry.title }} · {{ states[entry.lifecycle] || entry.lifecycle }}
          </p>
          <UButton
            color="neutral"
            variant="outline"
            :disabled="busy || selected.length >= 100 || entry.biz_id === item.biz_id || ['cancelled', 'merged'].includes(entry.lifecycle) || selected.some(old => old.biz_id === entry.biz_id)"
            @click="add(entry)"
          >
            {{ entry.biz_id === item.biz_id ? '当前事项' : selected.some(old => old.biz_id === entry.biz_id) ? '已选' : ['cancelled', 'merged'].includes(entry.lifecycle) ? '不可新增' : '添加为前置' }}
          </UButton>
        </div>
        <CommonEmptyState
          v-if="!data.items.length"
          icon="i-lucide-search"
          title="暂无符合条件的事项"
          description="请调整搜索条件。"
        />
        <p class="text-sm text-muted">
          候选共 {{ data.total }} 项；搜索和翻页不会移除已选前置。
        </p>
        <UPagination
          v-model:page="page"
          :items-per-page="10"
          :total="data.total"
          :sibling-count="0"
          :disabled="busy"
        />
      </template>
    </section>
    <section v-if="changed" class="space-y-2 rounded-lg border border-default p-3">
      <h2 class="font-semibold">
        本次变更
      </h2>
      <p class="break-words text-sm">
        新增 {{ added.length }} 项：{{ added.map(entry => entry.title).join('、') || '无' }}
      </p>
      <p class="break-words text-sm">
        移除 {{ removed.length }} 项：{{ removed.map(entry => entry.title).join('、') || '无' }}
      </p>
    </section>
    <UFormField label="变更原因" required>
      <UTextarea
        v-model="reason"
        class="w-full"
        :disabled="busy"
        :maxlength="2000"
      />
    </UFormField>
    <UFormField label="影响说明" :required="currentItem.requires_impact_note">
      <UTextarea
        v-model="impactNote"
        class="w-full"
        :disabled="busy"
        :maxlength="2000"
        placeholder="说明对已选范围、依赖顺序和交付安排的影响"
      />
    </UFormField>
    <UAlert v-if="alert" v-bind="alert" />
    <div class="flex flex-wrap gap-2">
      <UButton :disabled="!changed" :loading="busy" @click="save">
        保存前置依赖
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="busy"
        @click="emit('cancel')"
      >
        取消
      </UButton>
    </div>
  </div>
</template>
