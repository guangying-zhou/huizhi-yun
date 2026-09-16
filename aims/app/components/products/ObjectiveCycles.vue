<script setup lang="ts">
import { objectivePositive as positive, validProductObjective, type ProductObjective } from '~/utils/productObjectiveView'
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

const props = defineProps<{ productCode: string, objectiveId: number, objectiveStatus: string, workspaceRevision: number, disabled: boolean }>()
const emit = defineEmits<{ saved: [], busy: [value: boolean] }>()
interface CycleChoice { id: number, biz_id: string, product_code: string, title: string, status: string, revision: number, goal_summary: string, starts_on: string, ends_on: string }
interface Mapping { id: number, biz_id: string, product_code: string, objective_id: number, cycle_id: number, objective_revision: number, cycle_revision: number, objective_snapshot: ProductObjective, cycle_snapshot: ProductPlanningCycle & { id: number }, mapping_note: string, created_by: string, created_at: string, revoked_by: string | null, revoked_at: string | null, revocation_reason: string | null }
interface Page { items: Mapping[], total: number, page: number, pageSize: number, objective_id: number, objective_revision: number, workspace_revision: number }
const base = computed(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/objectives`)
const page = ref(1), pageSize = 10
const { data, status, error, refresh } = await useFetch(() => `${base.value}/${props.objectiveId}/cycles`, {
  server: false, query: computed(() => ({ page: page.value, pageSize })),
  transform: (response: { code: number, data: Page }) => {
    const result = response.data
    if (response.code !== 0 || !result || result.objective_id !== props.objectiveId || !positive(result.objective_revision) || !positive(result.workspace_revision) || !Number.isSafeInteger(result.total) || result.total < 0 || !Array.isArray(result.items) || result.page !== page.value || result.pageSize !== pageSize || result.items.length > pageSize || result.items.length > result.total || new Set(result.items.map(item => item.id)).size !== result.items.length || result.items.some(item => !positive(item.id) || !item.biz_id || item.product_code !== props.productCode || item.objective_id !== props.objectiveId || !positive(item.cycle_id) || !positive(item.objective_revision) || !positive(item.cycle_revision) || !validProductObjective(item.objective_snapshot, props.productCode) || item.objective_snapshot.id !== props.objectiveId || item.objective_snapshot.revision !== item.objective_revision || !item.cycle_snapshot || item.cycle_snapshot.id !== item.cycle_id || item.cycle_snapshot.product_code !== props.productCode || item.cycle_snapshot.revision !== item.cycle_revision || typeof item.cycle_snapshot.title !== 'string' || !item.cycle_snapshot.title.trim() || typeof item.cycle_snapshot.goal_summary !== 'string' || typeof item.mapping_note !== 'string' || !item.mapping_note.trim() || (item.revoked_at === null ? item.revoked_by !== null || item.revocation_reason !== null : typeof item.revoked_at !== 'string' || !item.revoked_by || !item.revocation_reason))) throw new Error('周期映射历史响应不完整')
    return result
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '周期映射加载失败' })
const { data: permission, status: permissionStatus, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, status: string, revision: number, edit: boolean } }>(() => `${base.value}/permissions`, { server: false })
const canEdit = computed(() => status.value === 'success' && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === props.productCode && permission.value.data.status === 'active' && permission.value.data.edit === true && permission.value.data.revision === props.workspaceRevision && data.value?.workspace_revision === props.workspaceRevision && ['draft', 'active'].includes(props.objectiveStatus))
const picking = ref(false), saving = ref(false), reason = ref(''), saveError = ref<Error | null>(null)
const selected = ref<{ title: string, action: 'cycle-map' | 'cycle-revoke', cycleId?: number, cycleRevision?: number, mappingId?: number, workspaceRevision: number, objectiveRevision: number } | null>(null)
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '周期映射保存失败' })
let retry: { payload: string, key: string } | undefined
const { confirm } = useConfirm()
const toast = useToast()
function choose(cycle: CycleChoice) {
  if (!canEdit.value || props.disabled || saving.value || !data.value) return
  selected.value = { title: cycle.title, action: 'cycle-map', cycleId: cycle.id, cycleRevision: cycle.revision, workspaceRevision: data.value.workspace_revision, objectiveRevision: data.value.objective_revision }
  picking.value = false
  reason.value = ''
  saveError.value = null
  retry = undefined
}
function revoke(item: Mapping) {
  if (!canEdit.value || props.disabled || saving.value || !data.value || item.revoked_at !== null) return
  selected.value = { title: item.cycle_snapshot.title, action: 'cycle-revoke', mappingId: item.id, workspaceRevision: data.value.workspace_revision, objectiveRevision: data.value.objective_revision }
  reason.value = ''
  saveError.value = null
  retry = undefined
}
async function reload() {
  await Promise.all([refresh(), refreshPermission()])
}
watch(() => props.workspaceRevision, () => reload())
async function save() {
  const selection = selected.value
  if (!selection || saving.value || !reason.value.trim()) return
  saving.value = true
  emit('busy', true)
  saveError.value = null
  const removing = selection.action === 'cycle-revoke'
  const body = { expectedRevision: selection.workspaceRevision, expectedObjectiveRevision: selection.objectiveRevision, reason: reason.value, ...(removing ? { mappingId: selection.mappingId } : { cycleId: selection.cycleId, expectedCycleRevision: selection.cycleRevision }) }
  const payload = JSON.stringify({ action: selection.action, body })
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  try {
    if (!await confirm({ title: removing ? '撤销周期映射' : '建立周期映射', message: `周期：${selection.title}\n原因：${body.reason}\n${removing ? '撤销后仍保留双方原快照和映射历史。' : '保存双方当前定义快照，保留周期原目标摘要；不会改变指标或评分。'}`, tone: removing ? 'danger' : 'warning', confirmLabel: removing ? '撤销映射' : '建立映射' })) return
    const response = await $fetch<{ code: number, data: { value: { id: number, biz_id: string, objective_id: number, cycle_id: number, revoked?: boolean, objective_revision: number, workspace_revision: number } } }, string>(`${base.value}/${props.objectiveId}/${selection.action}`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const result = response.data?.value
    if (response.code !== 0 || !result || !positive(result.id) || !result.biz_id || result.objective_id !== props.objectiveId || result.objective_revision !== selection.objectiveRevision + 1 || result.workspace_revision !== selection.workspaceRevision + 1 || (removing ? result.id !== selection.mappingId || result.revoked !== true : result.cycle_id !== selection.cycleId)) throw new Error('映射回执不完整，请重试')
    selected.value = null
    retry = undefined
    toast.add({ title: removing ? '周期映射已撤销' : '周期映射已建立', color: 'success' })
    emit('saved')
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('映射保存失败，请重试')
  } finally {
    saving.value = false
    emit('busy', false)
  }
}
</script>

<template>
  <section class="space-y-3" aria-label="目标周期映射">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-semibold">
        周期目标映射
      </h2>
      <div class="flex gap-2">
        <UButton
          v-if="canEdit"
          :disabled="disabled || saving"
          variant="outline"
          @click="picking = true"
        >
          映射规划周期
        </UButton>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="disabled || saving"
          :loading="status === 'pending'"
          @click="reload()"
        >
          刷新映射
        </UButton>
      </div>
    </div>
    <p class="text-sm text-muted">
      显示建立映射时保存的目标与周期定义，包含已撤销记录。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-else-if="status === 'pending'" class="text-sm text-muted">
      正在加载周期映射…
    </p>
    <template v-else-if="status === 'success' && data">
      <p v-if="data.total === 0" class="text-sm text-muted">
        尚无周期目标映射。
      </p>
      <UCard v-for="item in data.items" :key="item.id">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="break-words font-medium">
            {{ item.cycle_snapshot.title }}
          </h3>
          <UBadge color="neutral" variant="subtle">
            {{ item.revoked_at ? '已撤销 · 保留历史' : '有效映射' }}
          </UBadge>
        </div>
        <p class="mt-2 text-sm text-muted">
          {{ item.cycle_snapshot.starts_on }} 至 {{ item.cycle_snapshot.ends_on }}
        </p>
        <p class="mt-2 whitespace-pre-wrap break-words text-sm">
          原周期目标：{{ item.cycle_snapshot.goal_summary }}
        </p>
        <p class="mt-2 whitespace-pre-wrap break-words text-sm">
          对应目标：{{ item.objective_snapshot.title }} · {{ item.objective_snapshot.metric.name }}（{{ item.objective_snapshot.metric.unit }}），基线 {{ item.objective_snapshot.metric.baseline_value }} → 目标 {{ item.objective_snapshot.metric.target_value }}
        </p>
        <p class="mt-2 whitespace-pre-wrap break-words text-sm">
          映射说明：{{ item.mapping_note }}
        </p>
        <p v-if="item.revocation_reason" class="mt-2 whitespace-pre-wrap break-words text-sm">
          撤销原因：{{ item.revocation_reason }}
        </p>
        <UButton
          v-if="canEdit && item.revoked_at === null"
          color="error"
          variant="ghost"
          class="mt-2"
          :disabled="disabled || saving"
          @click="revoke(item)"
        >
          撤销映射
        </UButton>
      </UCard>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-muted">
          共 {{ data.total }} 条映射记录
        </p>
        <UPagination
          v-model:page="page"
          :items-per-page="pageSize"
          :total="data.total"
          :disabled="disabled || saving"
        />
      </div>
    </template>
    <UModal v-model:open="picking" title="选择规划周期" description="选择当前产品的周期，保存双方定义快照。">
      <template #body>
        <ProductsObjectiveCyclePicker v-if="picking" :product-code="productCode" @choose="choose" />
      </template>
    </UModal>
    <UModal
      :open="!!selected"
      :title="selected?.action === 'cycle-revoke' ? '撤销周期映射' : '建立周期映射'"
      description="填写原因，保留目标与周期原始定义。"
      :dismissible="!saving"
      :close="!saving"
      @update:open="(open) => { if (!open && !saving) selected = null }"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="save">
          <p class="break-words font-medium">
            {{ selected?.title }}
          </p>
          <UFormField label="映射或撤销原因" required>
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
            <UButton type="submit" :loading="saving" :disabled="!reason.trim()">
              继续
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </section>
</template>
