<script setup lang="ts">
import { validProductModelVersion } from '~/utils/productWeightedModel'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '发布 RICE 模型定义', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const base = computed(() => '/api/v1/products/' + encodeURIComponent(code.value) + '/priority-models')
const { data, status, error, refresh } = await useFetch<{ code: number, data: { product_code: string, status: string, revision: number, admin: boolean } }>(() => base.value + '/permissions', { server: false })
const canCreate = computed(() => status.value === 'success' && data.value?.code === 0 && data.value.data.product_code === code.value && data.value.data.status === 'active' && data.value.data.admin === true && Number.isSafeInteger(data.value.data.revision) && data.value.data.revision > 0)
const initial = () => ({ title: '', version: '', reason: '', reachUnit: 'unique_users', reachDefinition: '', reachStartsOn: '', reachEndsOn: '', sourceDefinition: '' })
const draft = ref(initial())
const validWindow = computed(() => {
  const start = new Date(draft.value.reachStartsOn + 'T00:00:00.000Z')
  const end = new Date(draft.value.reachEndsOn + 'T00:00:00.000Z')
  return /^[1-9]\d{3}-\d{2}-\d{2}$/.test(draft.value.reachStartsOn) && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(draft.value.reachEndsOn) && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start.toISOString().slice(0, 10) === draft.value.reachStartsOn && end.toISOString().slice(0, 10) === draft.value.reachEndsOn && end.getTime() >= start.getTime() && end.getTime() - start.getTime() <= 366 * 86400000
})
const valid = computed(() => draft.value.title.trim() && draft.value.reason.trim() && validProductModelVersion(draft.value.version) && draft.value.version !== 'weighted-value-effort-v1' && validWindow.value && draft.value.reachDefinition.trim() && draft.value.sourceDefinition.trim())
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
    const response = await $fetch<{ code: number, data: { value: { biz_id: string, product_code: string, version: string, title: string, method: string, workspace_revision: number } } }>(base.value + '/rice-create', { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const result = response.data?.value
    if (response.code !== 0 || !result?.biz_id || result.product_code !== code.value || result.version !== body.version || result.title !== body.title || result.method !== 'rice' || result.workspace_revision !== body.expectedRevision + 1) throw new Error('发布回执不完整，请重试')
    retry = undefined
    toast.add({ title: 'RICE 模型定义已发布', color: 'success' })
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
    <UAlert color="info" title="当前仅发布模型定义" description="数据来源说明不等于已验证的 Reach 证据。RICE 周期选用与评估尚未启用，发布不会改变现有周期。" />
    <form class="space-y-4" @submit.prevent="save">
      <fieldset :disabled="saving" class="space-y-4">
        <UFormField label="模型名称" required>
          <UInput v-model="draft.title" :maxlength="200" class="w-full" />
        </UFormField>
        <UFormField label="版本标识" description="产品内唯一，最多 64 个字符；不含斜杠、控制字符或首尾空格，例如 rice-person-day-v1。" required>
          <UInput v-model="draft.version" :maxlength="64" class="w-full" />
        </UFormField>
        <UFormField label="Reach 去重对象" required>
          <USelect v-model="draft.reachUnit" :items="[{ label: '去重用户数', value: 'unique_users' }, { label: '去重客户企业数', value: 'unique_customer_organizations' }]" class="w-full" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="统计开始日期" required>
            <UInput v-model="draft.reachStartsOn" type="date" class="w-full" />
          </UFormField>
          <UFormField label="统计结束日期" required>
            <UInput v-model="draft.reachEndsOn" type="date" class="w-full" />
          </UFormField>
        </div>
        <p v-if="draft.reachStartsOn && draft.reachEndsOn && !validWindow" class="text-sm text-error" role="status">
          请填写有效日期，结束日期不得早于开始日期，起止相差不得超过 366 天。
        </p>
        <UFormField label="去重与对象范围定义" description="明确去重标识、包含的对象和排除规则，避免混用用户数与客户企业数。" required>
          <UTextarea
            v-model="draft.reachDefinition"
            :maxlength="2000"
            :rows="3"
            class="w-full"
          />
        </UFormField>
        <UFormField label="数据来源定义" description="说明数据来自哪里，以及如何按统计窗口和对象范围取数。" required>
          <UTextarea
            v-model="draft.sourceDefinition"
            :maxlength="2000"
            :rows="3"
            class="w-full"
          />
        </UFormField>
        <p class="text-sm text-muted">
          RICE 人日分数 = Reach × 影响系数 × 置信度 ÷ 投入人日。影响系数为 0.25、0.50、1、2、3，置信度为 50%、80%、100%。
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
        发布 RICE 模型定义
      </UButton>
    </form>
  </div>
</template>
