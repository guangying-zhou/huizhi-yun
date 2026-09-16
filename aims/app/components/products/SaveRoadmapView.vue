<script setup lang="ts">
const props = defineProps<{ productCode: string, cycleId: string, year: number, quarter: number, unscheduled: boolean }>()
const open = ref(false), busy = ref(false), title = ref(''), audience = ref('planning'), visibility = ref('personal')
type Permission = { product_code: string, actor_uid: string, revision: number, status: string, edit: boolean }
const permission = ref<Permission | null>(null)
const error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '保存视图失败' })
const toast = useToast()
const { confirm } = useConfirm()
const base = computed(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/roadmaps/views`)
let retry: { payload: string, key: string } | undefined
const modal = computed({ get: () => open.value, set: (value) => {
  if (!busy.value) open.value = value
} })
async function start() {
  if (busy.value) return
  open.value = true
  busy.value = true
  error.value = null
  permission.value = null
  retry = undefined
  visibility.value = 'personal'
  try {
    const response = await $fetch<{ code: number, data: Permission }, string>(base.value + '/permissions', { timeout: 15000 })
    const value = response.data
    if (response.code !== 0 || !value || value.product_code !== props.productCode || !value.actor_uid || value.status !== 'active' || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.edit !== 'boolean') throw new Error('当前产品不可保存视图或权限响应不完整')
    permission.value = value
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('权限读取失败')
  } finally {
    busy.value = false
  }
}
async function save() {
  if (busy.value || !permission.value || !title.value.trim() || (visibility.value === 'product' && !permission.value.edit)) return
  const definition = { title: title.value, audience: audience.value, visibility: visibility.value, cycleId: props.cycleId, year: props.year, quarter: props.quarter, unscheduled: props.unscheduled }
  const body = { expectedRevision: permission.value.revision, definition }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  error.value = null
  try {
    if (visibility.value === 'product' && !(await confirm({ title: '保存产品共享视图', message: `“${title.value}”的名称和筛选将对有权限的产品用户可见，不会授予额外数据权限。`, tone: 'warning', confirmLabel: '保存共享视图' }))) return
    const response = await $fetch<{ code: number, data: { receipt_id: number, value: { biz_id: string, product_code: string, owner_uid: string, revision: number, workspace_revision: number, definition: { title: string, audience: string, visibility: string, cycle_biz_id: string, year: number, quarter: number, unscheduled: boolean } } } }, string>(base.value + '/create', { method: 'POST', body, headers: { 'Idempotency-Key': retry.key }, timeout: 15000 })
    const value = response.data?.value, saved = value?.definition
    if (response.code !== 0 || !Number.isSafeInteger(response.data?.receipt_id) || response.data.receipt_id < 1 || !value?.biz_id || value.product_code !== props.productCode || value.owner_uid !== permission.value.actor_uid || value.revision !== 1 || value.workspace_revision !== body.expectedRevision + 1 || !saved || saved.title !== definition.title || saved.audience !== definition.audience || saved.visibility !== definition.visibility || saved.cycle_biz_id !== definition.cycleId || saved.year !== definition.year || saved.quarter !== definition.quarter || saved.unscheduled !== definition.unscheduled) throw new Error('保存回执不完整，请保留当前内容重试')
    retry = undefined
    open.value = false
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
  <UButton color="neutral" variant="outline" @click="start">
    保存当前视图
  </UButton>
  <UModal
    v-model:open="modal"
    title="保存路线图视图"
    description="保存当前周期与季度筛选，展示方式不会改变规划顺序。"
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
            :disabled="busy || !permission"
            :items="[{ label: '仅自己', value: 'personal' }, { label: '产品内共享', value: 'product', disabled: !permission?.edit }]"
            class="w-full"
          />
        </UFormField>
        <UAlert v-if="alert" v-bind="alert" />
        <p v-if="error" class="text-sm text-muted">
          内容已保留。修订冲突时先保留文字，再重新读取权限。
        </p>
        <div class="flex flex-wrap gap-3">
          <UButton type="submit" :loading="busy" :disabled="!permission || !title.trim()">
            保存视图
          </UButton><UButton
            type="button"
            color="neutral"
            variant="ghost"
            :disabled="busy"
            @click="start"
          >
            重新读取权限
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
