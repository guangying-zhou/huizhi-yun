<script setup lang="ts">
import { validProductModelVersion } from '~/utils/productWeightedModel'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '发布评分模型版本', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const base = computed(() => '/api/v1/products/' + encodeURIComponent(code.value) + '/priority-models')
const { data, status, error, refresh } = await useFetch<{ code: number, data: { product_code: string, status: string, revision: number, admin: boolean } }>(() => base.value + '/permissions', { server: false })
const canCreate = computed(() => status.value === 'success' && data.value?.code === 0 && data.value.data.product_code === code.value && data.value.data.status === 'active' && data.value.data.admin === true && Number.isSafeInteger(data.value.data.revision) && data.value.data.revision > 0)
const initial = () => ({ title: '', version: '', reason: '', strategic: 30, userValue: 30, business: 20, risk: 20 })
const draft = ref(initial())
const fields = [{ key: 'strategic', label: '战略一致性' }, { key: 'userValue', label: '用户价值' }, { key: 'business', label: '商业价值' }, { key: 'risk', label: '风险降低' }] as const
const total = computed(() => fields.reduce((sum, field) => sum + Number(draft.value[field.key]), 0))
const valid = computed(() => draft.value.title.trim() && draft.value.reason.trim() && validProductModelVersion(draft.value.version) && draft.value.version !== 'weighted-value-effort-v1' && total.value === 100 && fields.every(field => Number.isInteger(draft.value[field.key]) && draft.value[field.key] >= 0 && draft.value[field.key] <= 100 && draft.value[field.key] % 5 === 0))
const saving = ref(false)
const saveError = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '模型权限加载失败' })
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '模型发布失败' })
const toast = useToast()
let retry: { payload: string, key: string } | undefined
async function save() {
  if (saving.value || !canCreate.value || !valid.value || !data.value) return
  saving.value = true
  saveError.value = null
  const body = { ...draft.value, expectedRevision: data.value.data.revision }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  try {
    const response = await $fetch<{ code: number, data: { value: { biz_id: string, product_code: string, version: string, title: string, method: string, workspace_revision: number } } }>(base.value + '/create', { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const result = response.data?.value
    if (response.code !== 0 || !result?.biz_id || result.product_code !== code.value || result.version !== body.version || result.title !== body.title || result.method !== 'weighted-value-effort' || result.workspace_revision !== body.expectedRevision + 1) throw new Error('发布回执不完整，请重试')
    retry = undefined
    toast.add({ title: '评分模型版本已发布', color: 'success' })
    saving.value = false
    await navigateTo('/products/' + encodeURIComponent(code.value) + '/models')
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('发布失败，请重试')
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
  <div class="mx-auto min-w-0 max-w-3xl space-y-4 p-4 sm:p-6">
    <UButton
      :to="'/products/' + encodeURIComponent(code) + '/models'"
      :disabled="saving"
      color="neutral"
      variant="ghost"
    >
      返回评分模型
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert
      v-if="status === 'success' && !canCreate"
      color="warning"
      title="当前不能发布模型"
      description="需要活动产品的优先级管理权限。"
    />
    <UAlert color="info" title="发布为独立版本" description="发布后不能修改或删除。后续调整请创建新版本；已有周期与历史评分保持原规则。" />
    <UButton
      :disabled="saving"
      :loading="status === 'pending'"
      color="neutral"
      variant="outline"
      @click="refresh()"
    >
      刷新权限与产品修订
    </UButton>
    <form class="space-y-4" @submit.prevent="save">
      <fieldset :disabled="saving" class="space-y-4">
        <UFormField label="模型名称" required>
          <UInput v-model="draft.title" :maxlength="200" class="w-full" />
        </UFormField>
        <UFormField label="版本标识" description="产品内唯一，最多 64 个字符；不含斜杠、控制字符或首尾空格，例如 customer-value-v2。" required>
          <UInput v-model="draft.version" :maxlength="64" class="w-full" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            v-for="field in fields"
            :key="field.key"
            :label="field.label + '（%）'"
            required
          >
            <UInput
              v-model.number="draft[field.key]"
              type="number"
              :min="0"
              :max="100"
              :step="5"
              class="w-full"
            />
          </UFormField>
        </div>
        <p :class="total === 100 ? 'text-success' : 'text-error'" role="status">
          权重合计 {{ total }}%（须为 100%，每项以 5% 为步长）
        </p>
        <p class="text-sm text-muted">
          价值维度按 0–5 分评价。优先分 = 加权价值分 × 置信度 ÷ 预计投入人日，保留八位小数。
        </p>
        <UFormField label="发布原因" required>
          <UTextarea
            v-model="draft.reason"
            :maxlength="2000"
            :rows="4"
            class="w-full"
          />
        </UFormField>
      </fieldset>
      <UAlert v-if="saveAlert" v-bind="saveAlert" />
      <UButton type="submit" :loading="saving" :disabled="!canCreate || !valid">
        发布新模型版本
      </UButton>
    </form>
  </div>
</template>
