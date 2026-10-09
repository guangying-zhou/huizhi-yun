<script setup lang="ts">
const props = defineProps<{ productCode: string, viewId: string, disabled?: boolean }>()
const emit = defineEmits<{ saved: [], busy: [value: boolean] }>()
type SavedView = { biz_id: string, product_code: string, owner_uid: string, revision: number, workspace_revision: number, definition: { title: string, audience: string, visibility: string, cycle_biz_id: string, year: number, quarter: number, unscheduled: boolean } }
const current = ref<SavedView | null>(null)
const year = ref(2026), quarter = ref(1), unscheduled = ref(false)
const canChangeVisibility = computed(() => !!current.value && current.value.owner_uid === permission.value?.actor_uid && permission.value.edit)
const open = ref(false), busy = ref(false), title = ref(''), audience = ref('planning'), visibility = ref('personal')
type Permission = { product_code: string, actor_uid: string, revision: number, status: string, edit: boolean }
const permission = ref<Permission | null>(null)
const error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '保存视图失败' })
const toast = useToast()
const { confirm } = useConfirm()
const base = computed(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/roadmaps/views`)
let retry: { payload: string, key: string } | undefined
watch(busy, value => emit('busy', value), { flush: 'sync' })
const modal = computed({ get: () => open.value, set: (value) => {
  if (!busy.value) open.value = value
} })
async function start(preserve = false) {
  if (busy.value) return
  open.value = true
  busy.value = true
  error.value = null
  permission.value = null
  retry = undefined
  current.value = null
  try {
    const response = await $fetch<{ code: number, data: Permission }, string>(base.value + '/permissions', { timeout: 15000 })
    const value = response.data
    if (response.code !== 0 || !value || value.product_code !== props.productCode || !value.actor_uid || value.status !== 'active' || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.edit !== 'boolean') throw new Error('当前产品不可保存视图或权限响应不完整')
    const detail = await $fetch<{ code: number, data: SavedView }, string>(`${base.value}/${props.viewId}`, { timeout: 15000 })
    const view = detail.data, definition = view?.definition
    if (detail.code !== 0 || view?.biz_id !== props.viewId || view.product_code !== props.productCode || !view.owner_uid || !Number.isSafeInteger(view.revision) || view.revision < 1 || view.workspace_revision !== value.revision || !definition || !definition.cycle_biz_id || !definition.title || !['planning', 'delivery', 'stakeholder'].includes(definition.audience) || !['personal', 'product'].includes(definition.visibility) || !Number.isInteger(definition.year) || definition.year < 1000 || definition.year > 9999 || !Number.isInteger(definition.quarter) || definition.quarter < 1 || definition.quarter > 4 || typeof definition.unscheduled !== 'boolean') throw new Error('视图或权限已变化，请重新读取')
    if (definition.visibility === 'personal' ? view.owner_uid !== value.actor_uid : !value.edit) throw new Error('当前无权编辑此视图')
    permission.value = value
    current.value = view
    if (!preserve) {
      title.value = definition.title
      audience.value = definition.audience
      visibility.value = definition.visibility
      year.value = definition.year
      quarter.value = definition.quarter
      unscheduled.value = definition.unscheduled
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('权限读取失败')
  } finally {
    busy.value = false
  }
}
async function save() {
  if (busy.value || !permission.value || !current.value || !title.value.trim() || (visibility.value === 'product' && !permission.value.edit)) return
  if (visibility.value !== current.value.definition.visibility && !canChangeVisibility.value) return
  const definition = { title: title.value, audience: audience.value, visibility: visibility.value, cycleId: current.value.definition.cycle_biz_id, year: Number(year.value), quarter: Number(quarter.value), unscheduled: unscheduled.value }
  const body = { expectedRevision: permission.value.revision, expectedViewRevision: current.value.revision, definition }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  error.value = null
  try {
    if ((visibility.value === 'product' || current.value.definition.visibility === 'product') && !(await confirm({ title: '修改共享视图', message: `“${title.value}”将更新名称、受众和筛选；改为个人后，其他产品用户将无法再应用此视图。`, tone: 'warning', confirmLabel: '保存共享视图' }))) return
    const response = await $fetch<{ code: number, data: { receipt_id: number, value: { biz_id: string, product_code: string, owner_uid: string, revision: number, workspace_revision: number, definition: { title: string, audience: string, visibility: string, cycle_biz_id: string, year: number, quarter: number, unscheduled: boolean } } } }, string>(`${base.value}/${props.viewId}`, { method: 'PATCH', body, headers: { 'Idempotency-Key': retry.key }, timeout: 15000 })
    const value = response.data?.value, saved = value?.definition
    if (response.code !== 0 || !Number.isSafeInteger(response.data?.receipt_id) || response.data.receipt_id < 1 || value?.biz_id !== props.viewId || value.product_code !== props.productCode || value.owner_uid !== current.value.owner_uid || value.revision !== body.expectedViewRevision + 1 || value.workspace_revision !== body.expectedRevision + 1 || !saved || saved.title !== definition.title || saved.audience !== definition.audience || saved.visibility !== definition.visibility || saved.cycle_biz_id !== definition.cycleId || saved.year !== definition.year || saved.quarter !== definition.quarter || saved.unscheduled !== definition.unscheduled) throw new Error('保存回执不完整，请保留当前内容重试')
    retry = undefined
    open.value = false
    emit('saved')
    toast.add({ title: '路线图视图已保存', color: 'success' })
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('保存失败')
  } finally {
    busy.value = false
  }
}
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
</script>

<template>
  <UButton
    size="sm"
    color="neutral"
    variant="ghost"
    :disabled="disabled || busy"
    @click="start()"
  >
    编辑
  </UButton>
  <UModal
    v-model:open="modal"
    title="编辑路线图视图"
    description="修改展示配置，保留原规划周期，不改变规划顺序。"
    :dismissible="!busy"
  >
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <p class="text-sm text-muted">
          {{ year }} Q{{ quarter }} · {{ unscheduled ? '未排期事项' : '季度内事项' }}
        </p>
        <UFormField label="视图名称" required>
          <UInput
            v-model="title"
            required
            :maxlength="200"
            :disabled="busy"
            class="w-full"
          />
        </UFormField>
        <UFormField label="受众">
          <USelect
            v-model="audience"
            :disabled="busy"
            :items="[{ label: '规划讨论', value: 'planning' }, { label: '交付协调', value: 'delivery' }, { label: '干系人概览', value: 'stakeholder' }]"
            class="w-full"
          />
        </UFormField>
        <UFormField label="可见性">
          <USelect
            v-model="visibility"
            :disabled="busy || !canChangeVisibility"
            :items="[{ label: '仅自己', value: 'personal' }, { label: '产品内共享', value: 'product', disabled: !permission?.edit }]"
            class="w-full"
          />
        </UFormField>
        <UFormField label="年份" required>
          <UInput
            v-model="year"
            type="number"
            :min="1000"
            :max="9999"
            :step="1"
            required
            :disabled="busy"
          />
        </UFormField>
        <UFormField label="季度">
          <USelect v-model="quarter" :items="[1, 2, 3, 4]" :disabled="busy" />
        </UFormField>
        <UCheckbox v-model="unscheduled" label="仅显示未排期事项" :disabled="busy" />
        <UAlert v-if="alert" v-bind="alert" />
        <p v-if="error" class="text-sm text-muted">
          内容已保留。修订冲突时先保留文字，再重新读取视图与权限。
        </p>
        <div class="flex flex-wrap gap-3">
          <UButton type="submit" :loading="busy" :disabled="!permission || !current || !title.trim()">
            保存视图
          </UButton><UButton
            type="button"
            color="neutral"
            variant="ghost"
            :disabled="busy"
            @click="start(true)"
          >
            重新读取视图与权限
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
