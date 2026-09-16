<script setup lang="ts">
import type { ProductVersionAcceptancePreview, VersionAcceptanceDetail } from '~/types/productVersionAcceptance'

const props = defineProps<{ productCode: string, versionId: string, record: VersionAcceptanceDetail }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const base = computed(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/versions/${encodeURIComponent(props.versionId)}`)
const { data: preview, error, status, refresh } = await useFetch(() => `${base.value}/acceptance-preview`, {
  server: false,
  transform: (response: { code: number, data: ProductVersionAcceptancePreview }) => {
    const p = response.data
    if (response.code !== 0 || p?.version?.product_code !== props.productCode || String(p.version.id) !== props.versionId || ![p.workspace_revision, p.version.revision, p.version.scope_revision].every(v => Number.isSafeInteger(v) && v > 0) || !Array.isArray(p.execution?.targets) || !Array.isArray(p.execution.open_defects)) throw new Error('发布检查响应不完整')
    return p
  }
})
const { data: permission, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, actor_uid: string, publish: boolean } }>(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/versions/permissions`, { server: false })
const alert = useApiErrorAlert(error, { fallbackTitle: '发布检查加载失败' })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '发布权限加载失败' })
const authorized = computed(() => permission.value?.code === 0 && permission.value.data.product_code === props.productCode && permission.value.data.publish === true)
const sameActor = computed(() => permission.value?.data.actor_uid === props.record.accepted_by)
const ownerMatches = computed(() => !!preview.value?.version.business_owner_uid && preview.value.version.business_owner_uid === props.record.accepted_by)
const canPublish = computed(() => authorized.value && !preview.value?.execution.restricted_item_count && ownerMatches.value && !sameActor.value && status.value === 'success' && preview.value?.product_status === 'active' && ['planning', 'developing'].includes(preview.value.version.status) && preview.value.version.scope_revision === props.record.scope_revision && preview.value.unresolved_scope_count === 0 && String(props.record.version_id) === props.versionId)
const saving = ref(false), reloading = ref(false), showing = ref(false), reviewed = ref(false)
const frozen = ref<ProductVersionAcceptancePreview | null>(null)
const reason = ref('')
const failure = ref<Error | null>(null)
const failureAlert = useApiErrorAlert(failure, { fallbackTitle: '发布失败' })
const completed = ref<number | null>(null)
const busy = computed(() => saving.value || reloading.value)
watch(busy, value => emit('busy', value), { flush: 'sync' })
const open = computed({ get: () => showing.value, set: (value: boolean) => {
  if (!busy.value) showing.value = value
} })
const { confirm } = useConfirm()
let retry: { payload: string, key: string } | undefined
function start() {
  if (!canPublish.value || busy.value || !preview.value) return
  frozen.value = structuredClone(toRaw(preview.value))
  reviewed.value = false
  failure.value = null
  showing.value = true
}
async function reload() {
  if (busy.value) return
  reloading.value = true
  reviewed.value = false
  try {
    await Promise.all([refresh(), refreshPermission()])
    frozen.value = status.value === 'success' && preview.value ? structuredClone(toRaw(preview.value)) : null
  } finally {
    reloading.value = false
  }
}
async function publish() {
  if (busy.value || !canPublish.value || !frozen.value || !reviewed.value || !reason.value.trim()) return
  const p = frozen.value
  const recordID = props.record.id
  const body = { acceptanceId: recordID, expectedRevision: p.workspace_revision, expectedVersionRevision: p.version.revision, expectedScopeRevision: p.version.scope_revision, reason: reason.value }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  saving.value = true
  failure.value = null
  try {
    if (!await confirm({ title: '确认正式发布', message: `版本：${p.version.version_code}\n验收记录：#${recordID}\n发布原因：${body.reason}\n将保存不可变发布记录并把版本标为已发布，不会自动部署客户环境。`, confirmLabel: '正式发布', tone: 'warning' })) return
    const response = await $fetch<{ code: number, data: { value: { release_record_id: number, version_id: number, product_code: string, status: string } } }>(`${base.value}/publish`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const result = response.data?.value
    if (response.code !== 0 || !Number.isSafeInteger(result?.release_record_id) || result.release_record_id < 1 || String(result.version_id) !== props.versionId || result.product_code !== props.productCode || result.status !== 'released') throw new Error('发布结果不完整，请保留原请求重试')
    completed.value = result.release_record_id
    reviewed.value = false
    showing.value = false
    retry = undefined
  } catch (cause) {
    failure.value = cause instanceof Error ? cause : new Error('发布失败')
  } finally {
    saving.value = false
  }
}
watch(() => preview.value?.review_hash, () => {
  reviewed.value = false
})
watch(() => `${props.productCode}/${props.versionId}/${props.record.id}`, () => {
  showing.value = false
  reviewed.value = false
  frozen.value = null
  reason.value = ''
  completed.value = null
  retry = undefined
})
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
</script>

<template>
  <section class="min-w-0 space-y-3">
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <UAlert v-if="preview?.execution.restricted_item_count" color="warning" title="部分项目明细不可见，请补齐查看权限后再核验发布" />
    <template v-if="completed">
      <UAlert color="success" title="版本已正式发布" description="发布内容已冻结保存；客户环境不会自动部署。" />
      <UButton :to="`/products/${encodeURIComponent(productCode)}/versions/${encodeURIComponent(versionId)}/releases/${completed}`">
        查看发布快照
      </UButton>
    </template>
    <template v-else>
      <UAlert
        v-if="status === 'success' && preview && !ownerMatches"
        color="warning"
        title="此验收记录不满足当前负责人要求"
        description="请先指定业务负责人，再由当前负责人重新验收后发布。原验收记录仍会保留。"
      />
      <p v-if="authorized && sameActor" class="text-sm text-muted">
        此记录由你验收，必须由另一位具有发布权限的成员确认发布。
      </p>
      <UButton v-if="canPublish" :disabled="busy" @click="start">
        依据此验收记录发布
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        :loading="reloading"
        :disabled="saving"
        @click="reload"
      >
        重新检查发布条件
      </UButton>
    </template>
    <UModal
      v-model:open="open"
      title="正式发布版本"
      description="核对所选验收记录和当前检查结果，再确认发布。"
      :dismissible="!busy"
      :close="!busy"
    >
      <template #body>
        <form class="min-w-0 space-y-4" @submit.prevent="publish">
          <UAlert v-if="failureAlert" v-bind="failureAlert" />
          <div v-if="frozen" class="space-y-2 text-sm">
            <p class="break-words">
              版本：{{ frozen.version.version_code }} · 验收记录 #{{ record.id }}
            </p>
            <p>范围 {{ frozen.scope_count }} 项，未处理 {{ frozen.unresolved_scope_count }} 项。</p>
            <p v-if="frozen.execution.no_execution_plan">
              当前没有可计算完成度的执行计划，请核对人工验收依据。
            </p>
            <p>未完成执行目标 {{ frozen.execution.targets.filter(item => item.status !== 'completed').length }} 项，关联未关闭缺陷 {{ frozen.execution.open_defects.length }} 项。</p>
            <p>验收例外 {{ record.exceptions.length }} 项。服务端将复核本记录对应的范围和执行事实，变化后必须重新验收。</p>
          </div>
          <UFormField label="发布原因" required>
            <UTextarea
              v-model="reason"
              required
              :maxlength="2000"
              :disabled="busy"
              class="w-full"
            />
          </UFormField>
          <UCheckbox v-model="reviewed" label="我已核验此记录的全部依据、例外和当前检查结果" :disabled="busy" />
          <div class="flex flex-wrap gap-2">
            <UButton type="submit" :loading="saving" :disabled="busy || !canPublish || !reviewed || !reason.trim()">
              确认发布
            </UButton>
            <UButton
              v-if="failure"
              color="neutral"
              variant="outline"
              :loading="reloading"
              :disabled="saving"
              @click="reload"
            >
              重新核验当前信息
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="busy"
              @click="showing = false"
            >
              取消
            </UButton>
          </div>
          <p v-if="failure" class="text-sm text-muted">
            发布原因已保留。刷新后需重新确认；验收失效时请先完成新的验收。
          </p>
        </form>
      </template>
    </UModal>
  </section>
</template>
