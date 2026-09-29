<script setup lang="ts">
import { useAimsModule } from '../../../../../../layer/useAimsModule'

const { moduleUrl, cacheKey } = useAimsModule()
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '功能生命周期', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.featureId || ''))
const path = computed(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/features/${encodeURIComponent(id.value)}`))
const states = { candidate: '候选', active: '已生效', deprecated: '已弃用' }
interface Evidence { kind: string, description: string, release_biz_id: string, confirmed_by: string, confirmed_at: string, reason: string }
interface Feature { biz_id: string, product_code: string, title: string, lifecycle: keyof typeof states, revision: number, lifecycle_evidence: Evidence | null }
interface Permission { product_code: string, status: string, revision: number, lifecycle: boolean }
const { data, status, error, refresh } = await useFetch(path, { server: false, key: computed(() => cacheKey('feature-lifecycle-1:' + code.value + ':' + String(route.params.featureId))), transform: (response: { code: number, data: Feature }) => {
  const f = response.data
  if (response.code !== 0 || f?.biz_id !== id.value || f.product_code !== code.value || !Object.hasOwn(states, f.lifecycle) || !Number.isSafeInteger(f.revision) || f.revision < 1) throw new Error('功能响应不完整')
  return f
} })
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: Permission }>(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/features/permissions`), { server: false, key: computed(() => cacheKey('feature-lifecycle-11:' + code.value + ':' + String(route.params.featureId))) })
const canChange = computed(() => status.value === 'success' && data.value && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.lifecycle === true && Number.isSafeInteger(permission.value.data.revision) && permission.value.data.revision > 0)
const target = computed(() => data.value?.lifecycle === 'active' ? 'deprecated' : 'active')
const label = computed(() => data.value?.lifecycle === 'active' ? '弃用功能' : data.value?.lifecycle === 'deprecated' ? '恢复功能' : '确认功能生效')
const kind = ref('legacy'), description = ref(''), releaseBizId = ref(''), reason = ref('')
const busy = ref(false)
const saveError = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '生命周期加载失败' })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '负责人权限加载失败' })
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '生命周期变更失败' })
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
const validEvidence = computed(() => target.value === 'deprecated' || (kind.value === 'legacy' ? !!description.value.trim() : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(releaseBizId.value)))
async function reload() {
  if (busy.value) return
  busy.value = true
  retry = undefined
  try {
    await Promise.all([refresh(), refreshPermission()])
  } finally {
    busy.value = false
  }
}
async function save() {
  if (busy.value || !canChange.value || !data.value || !permission.value || !reason.value.trim() || !validEvidence.value) return
  busy.value = true
  saveError.value = null
  let saved = false
  const body = { expectedRevision: permission.value.data.revision, expectedFeatureRevision: data.value.revision, target: target.value as 'active' | 'deprecated', reason: reason.value, evidence: target.value === 'deprecated' ? null : kind.value === 'legacy' ? { kind: 'legacy', description: description.value } : { kind: 'release', releaseBizId: releaseBizId.value } }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  try {
    const evidenceText = body.evidence ? body.evidence.kind === 'legacy' ? `存量能力证据：${description.value}` : `发布记录：${releaseBizId.value}` : '保留已有能力证据。'
    if (!(await confirm({ title: label.value, message: `功能：${data.value.title}\n${states[data.value.lifecycle]} → ${states[body.target]}\n原因：${body.reason}\n${evidenceText}`, tone: 'warning', confirmLabel: label.value }))) return
    const response = await $fetch<{ code: number }>(`${path.value}/lifecycle`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    if (response.code !== 0) throw new Error('保存结果不完整，请重试')
    saved = true
    toast.add({ title: '功能生命周期已更新', color: 'success' })
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('生命周期变更失败')
  } finally {
    busy.value = false
  }
  if (saved) await navigateTo(moduleUrl(`/products/${encodeURIComponent(code.value)}/features/${id.value}`))
}
watch([code, id], () => {
  kind.value = 'legacy'
  description.value = ''
  releaseBizId.value = ''
  reason.value = ''
  retry = undefined
  saveError.value = null
})
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-3xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap gap-2">
      <UButton
        :to="moduleUrl(`/products/${encodeURIComponent(code)}/features/${id}`)"
        color="neutral"
        variant="ghost"
        :disabled="busy"
      >
        返回功能详情
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        :loading="busy"
        @click="reload"
      >
        重新读取
      </UButton>
    </div>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <UAlert v-if="saveAlert" v-bind="saveAlert" />
    <p v-if="status === 'pending'" role="status">
      正在读取功能状态…
    </p>
    <template v-if="status === 'success' && data">
      <h1 class="break-words text-lg font-semibold">
        {{ data.title }} · {{ states[data.lifecycle] }}
      </h1>
      <section v-if="data.lifecycle_evidence" class="space-y-2 rounded-lg border border-default p-4 text-sm">
        <h2 class="font-semibold">
          当前能力证据
        </h2>
        <p class="whitespace-pre-wrap break-words">
          {{ data.lifecycle_evidence.description || data.lifecycle_evidence.release_biz_id }}
        </p>
        <p class="break-words">
          确认人：{{ data.lifecycle_evidence.confirmed_by }} · {{ data.lifecycle_evidence.confirmed_at }}
        </p>
        <p class="whitespace-pre-wrap break-words">
          {{ data.lifecycle_evidence.reason }}
        </p>
      </section>
      <form v-if="canChange" class="space-y-4" @submit.prevent="save">
        <p class="text-sm text-muted">
          {{ label }}需产品负责人确认。重新读取保留填写内容，请核对最新状态后再提交。
        </p>
        <template v-if="target === 'active'">
          <UFormField label="能力证据类型">
            <USelect v-model="kind" :disabled="busy" :items="[{ label: '已存在的能力', value: 'legacy' }, { label: '有效发布记录', value: 'release' }]" />
          </UFormField>
          <UFormField v-if="kind === 'legacy'" label="存量能力证据" required>
            <UTextarea
              v-model="description"
              class="w-full"
              :maxlength="10000"
              :disabled="busy"
              placeholder="描述已经可用的能力、使用范围及核验依据"
            />
          </UFormField>
          <UFormField v-else label="发布记录标识" required>
            <UInput
              v-model="releaseBizId"
              class="w-full"
              :disabled="busy"
              placeholder="引用包含本功能的有效发布记录"
            />
          </UFormField>
        </template>
        <UFormField label="变更原因" required>
          <UTextarea
            v-model="reason"
            class="w-full"
            :maxlength="2000"
            :disabled="busy"
          />
        </UFormField>
        <UButton type="submit" :loading="busy" :disabled="!reason.trim() || !validEvidence">
          {{ label }}
        </UButton>
      </form>
      <p v-else class="text-sm text-muted">
        仅具备功能维护权限的当前产品负责人可操作，归档产品需先恢复。
      </p>
    </template>
  </div>
</template>
