<script setup lang="ts">
import { objectivePositive as positive } from '~/utils/productObjectiveView'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '探索时间窗口', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.itemId || ''))
const base = computed(() => `/api/v1/products/${encodeURIComponent(code.value)}/roadmaps`)
interface Window { biz_id: string, product_code: string, title: string, lifecycle: string, starts_on: string | null, ends_on: string | null, revision: number, workspace_revision: number }
const date = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const { data, status, error, refresh } = await useFetch(() => `${base.value}/windows/${encodeURIComponent(id.value)}`, { server: false, transform: (response: { code: number, data: Window }) => {
  const result = response.data
  if (response.code !== 0 || !result || result.biz_id !== id.value || result.product_code !== code.value || typeof result.title !== 'string' || !result.title.trim() || !positive(result.revision) || !positive(result.workspace_revision) || !['proposed', 'in_delivery', 'delivered', 'cancelled', 'merged'].includes(result.lifecycle) || !((result.starts_on === null && result.ends_on === null) || (date(result.starts_on) && date(result.ends_on) && result.ends_on >= result.starts_on))) throw new Error('探索窗口响应不完整')
  return result
} })
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, status: string, revision: number, edit: boolean } }>(() => `${base.value}/permissions`, { server: false })
const reloading = ref(false)
const saving = ref(false), reason = ref(''), startsOn = ref(''), endsOn = ref(''), saveError = ref<Error | null>(null)
const canEdit = computed(() => status.value === 'success' && data.value && ['proposed', 'in_delivery'].includes(data.value.lifecycle) && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.edit === true && permission.value.data.revision === data.value.workspace_revision)
const valid = computed(() => !!reason.value.trim() && ((!startsOn.value && !endsOn.value) || (date(startsOn.value) && date(endsOn.value) && endsOn.value >= startsOn.value)))
const dirty = computed(() => !!data.value && (startsOn.value !== (data.value.starts_on ?? '') || endsOn.value !== (data.value.ends_on ?? '') || !!reason.value))
const alert = useApiErrorAlert(error, { fallbackTitle: '探索窗口加载失败' })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '路线图权限加载失败' })
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '探索窗口保存失败' })
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
watch(data, (value) => {
  if (!value || value.biz_id !== id.value || value.product_code !== code.value) return
  startsOn.value = value.starts_on ?? ''
  endsOn.value = value.ends_on ?? ''
  reason.value = ''
  retry = undefined
}, { immediate: true })
watch([code, id], () => {
  startsOn.value = ''
  endsOn.value = ''
  reason.value = ''
  saveError.value = null
  retry = undefined
})
async function reload() {
  if (saving.value || reloading.value) return
  reloading.value = true
  try {
    if (dirty.value && !await confirm({ title: '重新加载探索窗口', message: '重新加载会替换当前未保存的日期和原因。', tone: 'warning', confirmLabel: '重新加载' })) return
    saveError.value = null
    await Promise.all([refresh(), refreshPermission()])
  } finally {
    reloading.value = false
  }
}
async function save() {
  if (saving.value || reloading.value || !canEdit.value || !valid.value || !data.value) return
  const current = { ...data.value }
  const body = { startsOn: startsOn.value || null, endsOn: endsOn.value || null, expectedRevision: current.workspace_revision, expectedItemRevision: current.revision, reason: reason.value }
  saving.value = true
  saveError.value = null
  const payload = JSON.stringify({ code: code.value, id: id.value, body })
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  try {
    if (!await confirm({ title: body.startsOn ? '保存探索时间窗口' : '清空探索时间窗口', message: `事项：${current.title}\n${body.startsOn ? `${body.startsOn} 至 ${body.endsOn}` : '恢复为未安排时间窗口。'}\n原因：${body.reason}\n此操作调整探索安排，不构成交付承诺。`, tone: 'warning', confirmLabel: '保存窗口' })) return
    const response = await $fetch<{ code: number, data: { value: { biz_id: string, product_code: string, starts_on: string | null, ends_on: string | null, revision: number, workspace_revision: number } } }, string>(`${base.value}/windows/${encodeURIComponent(id.value)}`, { method: 'PATCH', body, headers: { 'Idempotency-Key': retry.key } })
    const result = response.data?.value
    if (response.code !== 0 || !result || result.biz_id !== current.biz_id || result.product_code !== current.product_code || result.starts_on !== body.startsOn || result.ends_on !== body.endsOn || result.revision !== current.revision + 1 || result.workspace_revision !== current.workspace_revision + 1) throw new Error('窗口回执不完整，请重试')
    retry = undefined
    toast.add({ title: body.startsOn ? '探索窗口已保存' : '探索窗口已清空', color: 'success' })
    await Promise.all([refresh(), refreshPermission()])
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('保存失败，请重试')
  } finally {
    saving.value = false
  }
}
onBeforeRouteLeave(() => !saving.value && !reloading.value)
onBeforeRouteUpdate(() => !saving.value && !reloading.value)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-3xl space-y-4 p-4 sm:p-6">
    <UButton
      :to="`/products/${encodeURIComponent(code)}/planning-items/${encodeURIComponent(id)}`"
      color="neutral"
      variant="ghost"
      :disabled="saving || reloading"
    >
      返回规划事项
    </UButton>
    <UButton
      :to="`/products/${encodeURIComponent(code)}/planning-items/${encodeURIComponent(id)}/commitments`"
      color="neutral"
      variant="outline"
      :disabled="saving || reloading"
    >
      承诺历史
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <UButton
      color="neutral"
      variant="outline"
      :disabled="saving || reloading"
      :loading="status === 'pending' || permissionStatus === 'pending'"
      @click="reload()"
    >
      重新加载窗口与权限
    </UButton>
    <UCard v-if="status === 'success' && data">
      <template #header>
        <h1 class="break-words font-semibold">
          {{ data.title }} · 探索时间窗口
        </h1>
      </template>
      <p class="mb-4 text-sm text-muted">
        用于季度路线安排，不构成交付承诺；留空表示尚未安排。现有优先级决定和版本范围保持不变。
      </p>
      <p v-if="!canEdit" class="mb-4 text-sm text-muted">
        当前只能查看：请确认路线编辑权限、产品及事项状态。
      </p>
      <form class="space-y-4" @submit.prevent="save">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="探索开始日期">
            <UInput
              v-model="startsOn"
              type="date"
              :disabled="saving || reloading || !canEdit"
              class="w-full"
            />
          </UFormField>
          <UFormField label="探索结束日期">
            <UInput
              v-model="endsOn"
              type="date"
              :min="startsOn || undefined"
              :disabled="saving || reloading || !canEdit"
              class="w-full"
            />
          </UFormField>
        </div>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="saving || reloading || !canEdit"
          @click="startsOn = ''; endsOn = ''"
        >
          清空日期
        </UButton>
        <UFormField v-if="canEdit" label="变更原因" required>
          <UTextarea
            v-model="reason"
            :maxlength="2000"
            :disabled="saving || reloading"
            class="w-full"
          />
        </UFormField>
        <UAlert v-if="saveAlert" v-bind="saveAlert" role="alert" />
        <div v-if="canEdit" class="flex justify-end">
          <UButton type="submit" :loading="saving" :disabled="!valid || reloading">
            保存探索窗口
          </UButton>
        </div>
      </form>
    </UCard>
  </div>
</template>
