<script setup lang="ts">
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '创建产品目标', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const base = computed(() => `/api/v1/products/${encodeURIComponent(code.value)}/objectives`)
const saving = ref(false)
const initial = () => ({ title: '', description: '', startsOn: '', endsOn: '', ownerUid: '', metric: { name: '', unit: '', measurementDefinition: '', direction: 'increase', baselineValue: '', targetValue: '' } })
const draft = ref(initial())
const { data: permission, status, error, refresh } = await useFetch<{ code: number, data: { product_code: string, status: string, revision: number, edit: boolean } }>(() => `${base.value}/permissions`, { server: false })
const canCreate = computed(() => status.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.edit === true && Number.isSafeInteger(permission.value.data.revision) && permission.value.data.revision > 0)
const alert = useApiErrorAlert(error, { fallbackTitle: '目标权限加载失败' })
const saveError = ref<Error | null>(null)
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '目标创建失败' })
const decimal = (value: string) => /^-?\d{1,14}(\.\d{1,6})?$/.test(value)
function scaled(value: string) {
  const negative = value.startsWith('-')
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.')
  return BigInt(`${whole}${fraction.padEnd(6, '0')}`) * (negative ? -1n : 1n)
}
const metricValid = computed(() => {
  const m = draft.value.metric
  if (!m.name.trim() || !m.unit.trim() || !m.measurementDefinition.trim() || !decimal(m.baselineValue) || !decimal(m.targetValue)) return false
  return m.direction === 'increase' ? scaled(m.targetValue) > scaled(m.baselineValue) : m.direction === 'decrease' && scaled(m.targetValue) < scaled(m.baselineValue)
})
const valid = computed(() => draft.value.title.trim() && draft.value.ownerUid && draft.value.startsOn && draft.value.endsOn >= draft.value.startsOn && metricValid.value)
let retry: { payload: string, key: string } | undefined
const toast = useToast()
async function save() {
  if (saving.value || !canCreate.value || !valid.value || !permission.value) return
  saving.value = true
  saveError.value = null
  const body = { ...draft.value, metric: { ...draft.value.metric }, expectedRevision: permission.value.data.revision }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  try {
    const response = await $fetch<{ code: number, data: { value: { id: number, biz_id: string, product_code: string, title: string, status: string, revision: number } } }, string>(base.value, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const result = response.data?.value
    if (response.code !== 0 || !result || !Number.isSafeInteger(result.id) || result.id < 1 || !result.biz_id || result.product_code !== code.value || result.title !== body.title || result.status !== 'draft' || result.revision !== 1) throw new Error('创建回执不完整，请重试')
    retry = undefined
    toast.add({ title: '产品目标草稿已创建', color: 'success' })
    saving.value = false
    await navigateTo(`/products/${encodeURIComponent(code.value)}/objectives`)
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('创建失败，请重试')
  } finally {
    saving.value = false
  }
}
watch(code, () => {
  draft.value = initial()
  retry = undefined
  saveError.value = null
})
onBeforeRouteLeave(() => !saving.value)
onBeforeRouteUpdate(() => !saving.value)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-4xl space-y-4 p-4 sm:p-6">
    <UButton
      :to="`/products/${encodeURIComponent(code)}/objectives`"
      :disabled="saving"
      color="neutral"
      variant="ghost"
      icon="i-lucide-arrow-left"
    >
      返回产品目标
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert
      v-if="status === 'success' && !canCreate"
      color="warning"
      title="当前不能创建目标"
      description="请确认产品未归档且具有目标编辑权限。"
    />
    <UButton
      color="neutral"
      variant="outline"
      :disabled="saving"
      :loading="status === 'pending'"
      @click="refresh()"
    >
      刷新权限与产品修订
    </UButton>
    <form class="space-y-4" @submit.prevent="save">
      <ProductsObjectiveFields v-model="draft" :saving="saving" :metric-valid="metricValid" />
      <UAlert v-if="saveAlert" v-bind="saveAlert" />
      <div class="flex flex-wrap justify-end gap-3">
        <UButton type="submit" :loading="saving" :disabled="!canCreate || !valid">
          创建目标草稿
        </UButton>
      </div>
    </form>
  </div>
</template>
