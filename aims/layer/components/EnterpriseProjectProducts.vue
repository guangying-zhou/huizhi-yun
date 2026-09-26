<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'

const props = defineProps<{ projectId: string, canEdit: boolean }>()
const { moduleUrl } = useAimsModule()
type Row = { product_code: string, is_primary?: boolean, version_id?: number | null }
const endpoint = computed(() => moduleUrl(`/api/v1/projects/${props.projectId}/products`))
const { data, status, error, refresh } = await useFetch<{ code: number, data: { items: Row[] } }>(endpoint, { server: false })
const alert = useApiErrorAlert(error, { fallbackTitle: '项目产品关联读取失败' })
const code = ref('')
const saving = ref(false)
const mutationError = ref<unknown>(null)
const mutationAlert = useApiErrorAlert(mutationError, { fallbackTitle: '项目产品关联失败' })
let retry: { payload: string, key: string } | undefined
async function link() {
  if (!props.canEdit || saving.value || !code.value.trim()) return
  const body = { productCode: code.value.trim() }
  const payload = JSON.stringify({ projectId: props.projectId, body })
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  saving.value = true
  mutationError.value = null
  try {
    const response = await $fetch<{ code: number, data?: { result?: { productCode?: string } } }>(endpoint.value, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key }, retry: 0 })
    if (response.code !== 0 || response.data?.result?.productCode !== body.productCode) throw new Error('关联响应无效')
    retry = undefined
    code.value = ''
    await refresh()
  } catch (cause) {
    mutationError.value = cause
    if ([400, 401, 403, 404, 409].includes(Number((cause as { statusCode?: number }).statusCode))) retry = undefined
  } finally { saving.value = false }
}
watch(() => props.projectId, () => {
  retry = undefined
  code.value = ''
})
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-semibold">
        关联产品
      </h2>
    </template>
    <UAlert v-if="alert" v-bind="alert" />
    <div v-else-if="status === 'pending'" class="text-sm text-muted">
      正在读取关联产品…
    </div>
    <ul v-else-if="data?.data?.items?.length" class="space-y-2">
      <li v-for="item in data.data.items" :key="item.product_code" class="flex flex-wrap items-center gap-2 text-sm">
        <span>{{ item.product_code }}</span><UBadge v-if="item.is_primary" color="primary" variant="subtle">
          主产品
        </UBadge>
      </li>
    </ul>
    <p v-else class="text-sm text-muted">
      暂无关联产品
    </p>
    <div v-if="canEdit" class="mt-4 flex flex-wrap items-end gap-2">
      <UFormField label="产品编码">
        <UInput
          v-model="code"
          placeholder="输入已有产品编码"
          :disabled="saving"
          @keyup.enter="link"
        />
      </UFormField>
      <UButton :loading="saving" :disabled="!code.trim()" @click="link">
        关联已有产品
      </UButton>
    </div>
    <UAlert v-if="mutationAlert" v-bind="mutationAlert" class="mt-3" />
  </UCard>
</template>
