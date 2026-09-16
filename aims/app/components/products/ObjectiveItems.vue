<script setup lang="ts">
import type { ObjectivePlanningChoice } from './ObjectiveItemPicker.vue'
import { objectivePositive as positive } from '~/utils/productObjectiveView'

const props = defineProps<{ productCode: string, objectiveId: number, objectiveStatus: string, workspaceRevision: number, disabled: boolean }>()
const emit = defineEmits<{ saved: [], busy: [value: boolean] }>()
interface Item { planning_item_id: number, biz_id: string, product_code: string, title: string, lifecycle: string, planning_revision: number, contribution_note: string, created_by: string, created_at: string }
interface Page { items: Item[], total: number, page: number, pageSize: number, objective_id: number, objective_revision: number, workspace_revision: number }
const states: Record<string, string> = { proposed: '待规划', in_delivery: '交付中', delivered: '已交付', cancelled: '已取消', merged: '已合并' }
const page = ref(1), pageSize = 10
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/objectives/${props.objectiveId}/items`, {
  server: false, query: computed(() => ({ page: page.value, pageSize })),
  transform: (response: { code: number, data: Page }) => {
    const result = response.data
    if (response.code !== 0 || !result || result.objective_id !== props.objectiveId || !positive(result.objective_revision) || !positive(result.workspace_revision) || !Number.isSafeInteger(result.total) || result.total < 0 || result.page !== page.value || result.pageSize !== pageSize || !Array.isArray(result.items) || result.items.length > pageSize || result.items.length > result.total || new Set(result.items.map(item => item.planning_item_id)).size !== result.items.length || result.items.some(item => !positive(item.planning_item_id) || !positive(item.planning_revision) || item.product_code !== props.productCode || typeof item.biz_id !== 'string' || !item.biz_id || typeof item.title !== 'string' || !item.title.trim() || !Object.hasOwn(states, item.lifecycle) || typeof item.contribution_note !== 'string' || !item.contribution_note.trim())) throw new Error('目标关联事项响应不完整')
    return result
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '目标关联事项加载失败' })
const { data: permission, status: permissionStatus, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, status: string, revision: number, edit: boolean } }>(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/objectives/permissions`, { server: false })
const canEdit = computed(() => status.value === 'success' && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === props.productCode && permission.value.data.status === 'active' && permission.value.data.edit === true && permission.value.data.revision === props.workspaceRevision && data.value?.workspace_revision === props.workspaceRevision && ['draft', 'active'].includes(props.objectiveStatus))
const selected = ref<{ item: Item, remove: boolean, adding: boolean, workspaceRevision: number, objectiveRevision: number } | null>(null)
const picking = ref(false)
const note = ref(''), reason = ref(''), saving = ref(false), saveError = ref<Error | null>(null)
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '目标关联更新失败' })
const valid = computed(() => !!reason.value.trim() && (selected.value?.remove || !!note.value.trim()))
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
function start(item: Item, remove: boolean, adding = false) {
  if (!canEdit.value || props.disabled || saving.value || !data.value || (!remove && ['cancelled', 'merged'].includes(item.lifecycle))) return
  selected.value = { item: structuredClone(toRaw(item)), remove, adding, workspaceRevision: data.value.workspace_revision, objectiveRevision: data.value.objective_revision }
  note.value = remove ? '' : item.contribution_note
  reason.value = ''
  saveError.value = null
  retry = undefined
}
function choose(item: ObjectivePlanningChoice) {
  if (!canEdit.value || props.disabled || saving.value) return
  const existing = data.value?.items.find(row => row.planning_item_id === item.id)
  start(existing ?? { planning_item_id: item.id, biz_id: item.biz_id, product_code: item.product_code, title: item.title, lifecycle: item.lifecycle, planning_revision: item.revision, contribution_note: '', created_by: '', created_at: '' }, false, !existing)
  picking.value = false
}
async function reload() {
  await Promise.all([refresh(), refreshPermission()])
}
watch(() => props.workspaceRevision, () => reload())
async function save() {
  const selection = selected.value
  if (!selection || saving.value || !valid.value) return
  saving.value = true
  emit('busy', true)
  saveError.value = null
  const body = { planningItemId: selection.item.planning_item_id, expectedRevision: selection.workspaceRevision, expectedObjectiveRevision: selection.objectiveRevision, expectedPlanningRevision: selection.item.planning_revision, contributionNote: selection.remove ? '' : note.value, remove: selection.remove, reason: reason.value }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  try {
    if (!await confirm({ title: selection.remove ? '解除目标关联' : selection.adding ? '关联规划事项' : '修改贡献说明', message: `事项：${selection.item.title}\n${selection.remove ? '解除与当前目标的关联，事项及观测历史保留。' : `贡献说明：${body.contributionNote}`}\n原因：${body.reason}`, tone: selection.remove ? 'danger' : 'warning', confirmLabel: selection.remove ? '解除关联' : '保存说明' })) return
    const response = await $fetch<{ code: number, data: { value: { objective_id: number, planning_item_id: number, linked: boolean, contribution_note: string, objective_revision: number, workspace_revision: number } } }, string>(`/api/v1/products/${encodeURIComponent(props.productCode)}/objectives/${props.objectiveId}/item-link`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const result = response.data?.value
    if (response.code !== 0 || !result || result.objective_id !== props.objectiveId || result.planning_item_id !== body.planningItemId || result.linked !== !selection.remove || result.contribution_note !== body.contributionNote || result.objective_revision !== selection.objectiveRevision + 1 || result.workspace_revision !== selection.workspaceRevision + 1) throw new Error('关联回执不完整，请重试')
    selected.value = null
    retry = undefined
    toast.add({ title: selection.remove ? '目标关联已解除' : '目标关联已保存', color: 'success' })
    emit('saved')
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('关联更新失败，请重试')
  } finally {
    saving.value = false
    emit('busy', false)
  }
}
</script>

<template>
  <section class="space-y-3" aria-label="目标关联规划事项">
    <div class="flex items-center justify-between gap-3">
      <h2 class="font-semibold">
        关联规划事项
      </h2>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="disabled || saving"
        :loading="status === 'pending'"
        @click="reload()"
      >
        刷新关联
      </UButton>
    </div>
    <UButton
      v-if="canEdit"
      :disabled="disabled || saving"
      variant="outline"
      @click="picking = true"
    >
      关联规划事项
    </UButton>
    <UModal v-model:open="picking" title="选择规划事项" description="选择当前产品的规划事项；若该事项已有关联，保存会更新其贡献说明。">
      <template #body>
        <ProductsObjectiveItemPicker v-if="picking" :product-code="productCode" @choose="choose" />
      </template>
    </UModal>
    <p class="text-sm text-muted">
      贡献说明用于解释事项如何支持目标；事项交付状态不等同于目标达成率。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-else-if="status === 'pending'" class="text-sm text-muted">
      正在加载关联事项…
    </p>
    <template v-else-if="status === 'success' && data">
      <p v-if="data.total === 0" class="text-sm text-muted">
        尚未关联规划事项。
      </p>
      <UCard v-for="item in data.items" :key="item.planning_item_id">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <UButton
            :to="`/products/${encodeURIComponent(productCode)}/planning-items/${encodeURIComponent(item.biz_id)}`"
            :disabled="disabled || saving"
            variant="link"
            class="min-w-0 whitespace-normal text-left"
          >
            {{ item.title }}
          </UButton>
          <UBadge color="neutral" variant="subtle">
            {{ states[item.lifecycle] }}
          </UBadge>
        </div>
        <p class="mt-2 whitespace-pre-wrap break-words text-sm">
          {{ item.contribution_note }}
        </p>
        <div v-if="canEdit" class="mt-3 flex flex-wrap gap-2">
          <UButton
            v-if="!['cancelled', 'merged'].includes(item.lifecycle)"
            color="neutral"
            variant="outline"
            :disabled="disabled || saving"
            @click="start(item, false)"
          >
            修改贡献说明
          </UButton>
          <UButton
            color="error"
            variant="ghost"
            :disabled="disabled || saving"
            @click="start(item, true)"
          >
            解除关联
          </UButton>
        </div>
      </UCard>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-muted">
          共 {{ data.total }} 项关联
        </p>
        <UPagination
          v-model:page="page"
          :items-per-page="pageSize"
          :total="data.total"
          :disabled="disabled || saving"
        />
      </div>
    </template>
    <UModal
      :open="!!selected"
      :title="selected?.remove ? '解除目标关联' : selected?.adding ? '关联规划事项' : '修改贡献说明'"
      description="记录变更原因，规划事项与历史观测保持不变。"
      :dismissible="!saving"
      :close="!saving"
      @update:open="(open) => { if (!open && !saving) selected = null }"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="save">
          <p v-if="selected?.adding" class="text-sm text-muted">
            若该事项已关联，保存会更新原贡献说明。
          </p>
          <p class="break-words font-medium">
            {{ selected?.item.title }}
          </p>
          <UFormField v-if="!selected?.remove" label="贡献说明" required>
            <UTextarea
              v-model="note"
              :maxlength="2000"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>
          <UFormField label="变更原因" required>
            <UTextarea
              v-model="reason"
              :maxlength="2000"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>
          <UAlert v-if="saveAlert" v-bind="saveAlert" />
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="saving"
              @click="selected = null"
            >
              取消
            </UButton>
            <UButton
              type="submit"
              :loading="saving"
              :disabled="!valid"
              :color="selected?.remove ? 'error' : 'primary'"
            >
              继续
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </section>
</template>
