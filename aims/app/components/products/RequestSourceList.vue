<script setup lang="ts">
const props = defineProps<{ productCode: string, requestId: string, canDelete?: boolean }>()
interface Source {
  id: number
  revision: number
  source_app: string | null
  source_type: string
  source_biz_id: string | null
  source_note: string
  evidence_date: string | null
  evidence_kind: string
  direction: string
  verification_status: string
  created_by: string
  created_at: string
}
const emit = defineEmits<{ changed: [], busyChange: [busy: boolean] }>()
const deleting = ref<{ source: Source, workspaceRevision: number, requestRevision: number } | null>(null)
const reason = ref('')
const busy = ref(false)
watch(busy, value => emit('busyChange', value), { flush: 'sync' })
const deleteError = ref<Error | null>(null)
const deleteAlert = useApiErrorAlert(deleteError, { fallbackTitle: '删除证据失败' })
const { confirm } = useConfirm()
let retry: { payload: string, key: string } | undefined
function removable(source: Source) {
  return props.canDelete && source.source_type === 'manual' && source.source_app === null && source.source_biz_id === null && source.verification_status === 'unverified'
}
function startDelete(source: Source) {
  if (busy.value || status.value !== 'success' || !data.value || !removable(source)) return
  deleting.value = { source: { ...source }, workspaceRevision: data.value.workspace_revision, requestRevision: data.value.request_revision }
  reason.value = ''
  deleteError.value = null
  retry = undefined
}
async function removeSource() {
  const target = deleting.value
  if (busy.value || !target || !removable(target.source)) return
  if (!reason.value.trim()) {
    deleteError.value = new Error('请填写删除原因')
    return
  }
  const body = { expectedRevision: target.workspaceRevision, expectedRequestRevision: target.requestRevision, expectedSourceRevision: target.source.revision, reason: reason.value }
  const endpoint = `/api/v1/products/${encodeURIComponent(props.productCode)}/requests/${props.requestId}/sources/${target.source.id}`
  busy.value = true
  deleteError.value = null
  try {
    if (!(await confirm({ title: '删除来源证据', message: `${target.source.source_note}\n删除原因：${reason.value}\n删除后保留审计记录，关联评估需要复评。`, tone: 'danger', confirmLabel: '确认删除证据' }))) return
    const payload = JSON.stringify({ id: target.source.id, body })
    if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
    const response = await $fetch<{ code: number }>(endpoint, { method: 'DELETE', body, headers: { 'Idempotency-Key': retry.key } })
    if (response.code !== 0) throw new Error('删除结果不完整，请重试')
    deleting.value = null
    emit('changed')
  } catch (cause) {
    deleteError.value = cause instanceof Error ? cause : new Error('删除证据失败')
  } finally {
    busy.value = false
  }
}
const page = ref(1)
watch(() => props.requestId, () => {
  page.value = 1
})
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/requests/${props.requestId}/sources`, {
  server: false, query: computed(() => ({ page: page.value, pageSize: 10 })),
  transform: (response: { code: number, data: { items: Source[], total: number, request_revision: number, workspace_revision: number } }) => {
    if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0) throw new Error('来源证据响应不完整')
    return response.data
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '来源证据加载失败' })
const directions: Record<string, string> = { supporting: '支持', opposing: '反对', neutral: '中立' }
const verification: Record<string, string> = { unverified: '未验证', verified: '已验证', unavailable: '暂无法验证' }
</script>

<template>
  <section class="min-w-0 space-y-3 border-t border-default pt-4" aria-label="来源证据">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="font-medium">
        来源证据
      </h3>
      <UButton
        color="neutral"
        variant="ghost"
        :loading="status === 'pending'"
        :disabled="busy"
        @click="refresh()"
      >
        刷新证据
      </UButton>
    </div>
    <p class="text-xs text-muted">
      事实／假设表示记录类别；验证状态单独标示。人工说明默认为未验证，重复反馈不会自动增加优先级分数。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
      正在加载证据…
    </p>
    <template v-else-if="status === 'success'">
      <p v-if="!data?.items.length" class="text-sm text-muted">
        {{ data?.total ? '当前页没有证据，请返回前页' : '暂无来源证据' }}
      </p>
      <ol v-else class="space-y-3">
        <li v-for="source in data.items" :key="source.id" class="space-y-2 rounded-lg border border-default p-3">
          <div class="flex flex-wrap gap-2">
            <UBadge color="neutral" variant="subtle">
              {{ source.evidence_kind === 'fact' ? '事实' : source.evidence_kind === 'assumption' ? '假设' : source.evidence_kind }}
            </UBadge>
            <UBadge :color="source.direction === 'opposing' ? 'warning' : 'neutral'" variant="subtle">
              {{ directions[source.direction] || source.direction }}
            </UBadge>
            <UBadge :color="source.verification_status === 'verified' ? 'success' : 'neutral'" variant="outline">
              {{ verification[source.verification_status] || source.verification_status }}
            </UBadge>
          </div>
          <p class="whitespace-pre-wrap break-words text-sm">
            {{ source.source_note }}
          </p>
          <p class="break-words text-xs text-muted">
            证据日期：{{ source.evidence_date || '未知' }} · {{ source.source_type === 'manual' ? '人工说明' : source.source_type }}
          </p>
          <p v-if="source.source_app || source.source_biz_id" class="break-all text-xs text-muted">
            来源引用：{{ source.source_app || '未知应用' }} / {{ source.source_biz_id || '未知标识' }}
          </p>
          <p class="break-words text-xs text-muted">
            {{ source.created_by }} · {{ formatDateTime(source.created_at) }} 记录
          </p>
          <UButton
            v-if="removable(source) && deleting?.source.id !== source.id"
            color="error"
            variant="ghost"
            :disabled="busy"
            @click="startDelete(source)"
          >
            删除证据
          </UButton>
          <form v-if="deleting?.source.id === source.id" class="space-y-3" @submit.prevent="removeSource">
            <UAlert v-if="deleteAlert" v-bind="deleteAlert" />
            <UFormField label="删除原因" name="sourceDeleteReason" required>
              <UTextarea
                v-model="reason"
                required
                :maxlength="2000"
                :disabled="busy"
                class="w-full"
              />
            </UFormField>
            <p class="text-xs text-muted">
              删除后保留审计记录，关联评估需要复评。若记录已变化，请复制原因，取消删除并刷新证据，核对新内容后重新发起。
            </p>
            <div class="flex flex-wrap gap-2">
              <UButton type="submit" color="error" :loading="busy">
                删除证据
              </UButton>
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                :disabled="busy"
                @click="deleting = null"
              >
                取消
              </UButton>
            </div>
          </form>
        </li>
      </ol>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs text-muted">共 {{ data?.total || 0 }} 条证据</span>
        <UPagination
          v-model:page="page"
          :disabled="busy"
          :total="data?.total || 0"
          :items-per-page="10"
          :sibling-count="0"
          show-edges
        />
      </div>
    </template>
  </section>
</template>
