<script setup lang="ts">
import { useAimsModule } from '../../../../../../layer/useAimsModule'
import ProductsVersionDevelopmentAction from '../../../../../components/products/VersionDevelopmentAction.vue'

const { moduleUrl, hosted, cacheKey } = useAimsModule()
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '版本详情', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const versionPerspectiveQuery = computed(() => route.query.view === 'gtm' ? { view: 'gtm' } : {})
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.versionId || ''))
const base = computed(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/versions`))
const endpoint = computed(() => `${base.value}/${encodeURIComponent(id.value)}`)
const states = { planning: '规划中', developing: '开发中', released: '已发布', archived: '已归档' }
interface Version { business_owner_uid?: string | null, current_release_record_id: number | null, id: number, product_code: string, version_code: string, name: string | null, description: string | null, planned_release_date: string | null, status: keyof typeof states, revision: number, scope_revision: number, workspace_revision: number }
const { data, status, error, refresh } = await useFetch(endpoint, { ...(hosted ? { key: computed(() => cacheKey('aims/app/pages/products/[productCode]/versions/[versionId]/index.vue:0' + ':' + String(toValue(endpoint)))) } : {}), server: false, transform: (response: { code: number, data: Version }) => {
  const v = response.data
  if (response.code !== 0 || v?.product_code !== code.value || String(v.id) !== id.value || !Object.hasOwn(states, v.status) || !Number.isSafeInteger(v.revision) || v.revision < 1 || !Number.isSafeInteger(v.workspace_revision) || v.workspace_revision < 1) throw new Error('版本详情响应不完整')
  return v
} })
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, status: string, edit: boolean, reopen: boolean, archive: boolean, delete: boolean } }>(() => `${base.value}/permissions`, { ...(hosted ? { key: computed(() => cacheKey('aims/app/pages/products/[productCode]/versions/[versionId]/index.vue:1' + ':' + String(toValue(() => `${base.value}/permissions`)))) } : {}), server: false })
const canEdit = computed(() => status.value === 'success' && data.value?.product_code === code.value && String(data.value.id) === id.value && ['planning', 'developing'].includes(data.value.status) && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.edit === true)
const alert = useApiErrorAlert(error, { fallbackTitle: '版本详情加载失败' })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '版本权限加载失败' })
const draft = reactive({ versionCode: '', name: '', description: '', plannedReleaseDate: '', businessOwnerUid: '', reason: '' })
const editing = ref(false), saving = ref(false), reloading = ref(false)
const revisions = ref({ workspace: 0, version: 0 })
const saveError = ref<Error | null>(null)
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '版本修改失败' })
const toast = useToast()
const { confirm } = useConfirm()
let retry: { payload: string, key: string } | undefined
const reopenDraft = ref<{ record: number, workspace: number, version: number, name: string } | null>(null)
const reopenReason = ref('')
const reopenedRecord = ref<number | null>(null)
const reopenError = ref<Error | null>(null)
const reopenAlert = useApiErrorAlert(reopenError, { fallbackTitle: '撤回重开失败' })
let reopenRetry: { payload: string, key: string } | undefined
const canReopen = computed(() => status.value === 'success' && data.value?.status === 'released' && data.value.current_release_record_id && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.reopen === true)
const reopenOpen = computed({ get: () => reopenDraft.value !== null, set: (value: boolean) => {
  if (!value && !saving.value && !reloading.value) reopenDraft.value = null
} })
function startReopen() {
  if (!canReopen.value || !data.value?.current_release_record_id || saving.value || reloading.value) return
  reopenDraft.value = { record: data.value.current_release_record_id, workspace: data.value.workspace_revision, version: data.value.revision, name: data.value.version_code }
  reopenReason.value = ''
  reopenError.value = null
  reopenRetry = undefined
}
async function reopen() {
  if (!canReopen.value || !reopenDraft.value || saving.value || reloading.value || !reopenReason.value.trim()) return
  const selected = reopenDraft.value
  const body = { releaseRecordId: selected.record, expectedRevision: selected.workspace, expectedVersionRevision: selected.version, reason: reopenReason.value }
  const payload = JSON.stringify(body)
  if (reopenRetry?.payload !== payload) reopenRetry = { payload, key: crypto.randomUUID() }
  saving.value = true
  reopenError.value = null
  let completed = false
  try {
    if (!await confirm({ title: '撤回发布并重新开发', message: `版本：${selected.name}\n发布记录：#${selected.record}\n原因：${body.reason}\n原快照保留并标记撤回，版本回到开发中，必须重新验收后才能发布更正。不会回滚客户环境部署。`, confirmLabel: '撤回并重开', tone: 'warning' })) return
    const response = await $fetch<{ code: number, data: { value: { version_id: number, release_record_id: number, status: string } } }>(`${endpoint.value}/reopen`, { method: 'POST', body, headers: { 'Idempotency-Key': reopenRetry.key } })
    const result = response.data?.value
    if (response.code !== 0 || String(result?.version_id) !== id.value || result.release_record_id !== selected.record || result.status !== 'developing') throw new Error('重开结果不完整，请使用原请求重试')
    reopenedRecord.value = selected.record
    reopenDraft.value = null
    reopenRetry = undefined
    completed = true
  } catch (cause) {
    reopenError.value = cause instanceof Error ? cause : new Error('重开失败')
  } finally {
    saving.value = false
  }
  if (completed) await reload()
}
const archiveDraft = ref<{ workspace: number, version: number, scope: number, name: string } | null>(null)
const archiveReason = ref('')
const archiveError = ref<Error | null>(null)
const archiveAlert = useApiErrorAlert(archiveError, { fallbackTitle: '归档版本失败' })
let archiveRetry: { payload: string, key: string } | undefined
const canArchive = computed(() => status.value === 'success' && data.value?.product_code === code.value && String(data.value.id) === id.value && data.value.status === 'released' && Number.isSafeInteger(data.value.scope_revision) && data.value.scope_revision > 0 && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.archive === true)
const archiveOpen = computed({ get: () => archiveDraft.value !== null, set: (value: boolean) => {
  if (!value && !saving.value && !reloading.value) archiveDraft.value = null
} })
function startArchive() {
  if (!canArchive.value || !data.value || saving.value || reloading.value) return
  archiveDraft.value = { workspace: data.value.workspace_revision, version: data.value.revision, scope: data.value.scope_revision, name: data.value.version_code }
  archiveReason.value = ''
  archiveError.value = null
  archiveRetry = undefined
}
async function archive() {
  if (!canArchive.value || !archiveDraft.value || saving.value || reloading.value || !archiveReason.value.trim()) return
  const selected = archiveDraft.value
  const body = { expectedRevision: selected.workspace, expectedVersionRevision: selected.version, expectedScopeRevision: selected.scope, reason: archiveReason.value }
  const payload = JSON.stringify(body)
  if (archiveRetry?.payload !== payload) archiveRetry = { payload, key: crypto.randomUUID() }
  saving.value = true
  archiveError.value = null
  let completed = false
  try {
    if (!await confirm({ title: '版本归档', message: `版本：${selected.name}\n原因：${body.reason}\n版本将归档并停止修改；发布快照及历史范围保留。`, confirmLabel: '归档版本', tone: 'warning' })) return
    const response = await $fetch<{ code: number, data: { value: { version_id: number, product_code: string, status: string } } }>(`${endpoint.value}/archive`, { method: 'POST', body, headers: { 'Idempotency-Key': archiveRetry.key } })
    const result = response.data?.value
    if (response.code !== 0 || String(result?.version_id) !== id.value || result.product_code !== code.value || result.status !== 'archived') throw new Error('状态结果不完整，请使用原请求重试')
    archiveDraft.value = null
    archiveRetry = undefined
    completed = true
    toast.add({ title: '版本已归档', color: 'success' })
  } catch (cause) {
    archiveError.value = cause instanceof Error ? cause : new Error('归档版本失败')
  } finally {
    saving.value = false
  }
  if (completed) await reload()
}
const deletionDraft = ref<{ workspace: number, version: number, scope: number, name: string } | null>(null)
const deletionReason = ref('')
const deletionError = ref<Error | null>(null)
const deletionAlert = useApiErrorAlert(deletionError, { fallbackTitle: '删除版本失败' })
let deletionRetry: { payload: string, key: string } | undefined
const canDelete = computed(() => status.value === 'success' && data.value?.product_code === code.value && String(data.value.id) === id.value && data.value.status === 'planning' && Number.isSafeInteger(data.value.scope_revision) && data.value.scope_revision > 0 && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.delete === true)
const deletionOpen = computed({ get: () => deletionDraft.value !== null, set: (value: boolean) => {
  if (!value && !saving.value && !reloading.value) deletionDraft.value = null
} })
function startDelete() {
  if (!canDelete.value || !data.value || saving.value || reloading.value) return
  deletionDraft.value = { workspace: data.value.workspace_revision, version: data.value.revision, scope: data.value.scope_revision, name: data.value.version_code }
  deletionReason.value = ''
  deletionError.value = null
  deletionRetry = undefined
}
async function removeVersion() {
  if (!canDelete.value || !deletionDraft.value || saving.value || reloading.value || !deletionReason.value.trim()) return
  const selected = deletionDraft.value
  const body = { expectedRevision: selected.workspace, expectedVersionRevision: selected.version, expectedScopeRevision: selected.scope, reason: deletionReason.value }
  const payload = JSON.stringify(body)
  if (deletionRetry?.payload !== payload) deletionRetry = { payload, key: crypto.randomUUID() }
  saving.value = true
  deletionError.value = null
  let completed = false
  try {
    if (!await confirm({ title: '版本删除', message: `版本：${selected.name}\n原因：${body.reason}\n仅无范围、执行工作项、项目绑定、验收及发布记录的规划版本可删除；删除后不可恢复。`, confirmLabel: '删除版本', tone: 'danger' })) return
    const response = await $fetch<{ code: number, data: { value: { version_id: number, product_code: string, deleted: boolean } } }>(endpoint.value, { method: 'DELETE', body, headers: { 'Idempotency-Key': deletionRetry.key } })
    const result = response.data?.value
    if (response.code !== 0 || String(result?.version_id) !== id.value || result.product_code !== code.value || result.deleted !== true) throw new Error('状态结果不完整，请使用原请求重试')
    deletionDraft.value = null
    deletionRetry = undefined
    completed = true
    toast.add({ title: '版本已删除', color: 'success' })
  } catch (cause) {
    deletionError.value = cause instanceof Error ? cause : new Error('删除版本失败')
  } finally {
    saving.value = false
  }
  if (completed) await navigateTo(moduleUrl(`/products/${encodeURIComponent(code.value)}/versions`))
}
function bindRevisions() {
  if (canEdit.value && data.value) revisions.value = { workspace: data.value.workspace_revision, version: data.value.revision }
}
function start() {
  if (!canEdit.value || !data.value || saving.value || reloading.value) return
  Object.assign(draft, { businessOwnerUid: data.value.business_owner_uid || '', versionCode: data.value.version_code, name: data.value.name || '', description: data.value.description || '', plannedReleaseDate: data.value.planned_release_date || '', reason: '' })
  retry = undefined
  saveError.value = null
  bindRevisions()
  editing.value = true
}
async function reload() {
  if (saving.value || reloading.value) return
  reloading.value = true
  revisions.value = { workspace: 0, version: 0 }
  try {
    await Promise.all([refresh(), refreshPermission()])
    bindRevisions()
  } finally {
    reloading.value = false
  }
}
async function save() {
  if (saving.value || reloading.value || !canEdit.value || !revisions.value.workspace || !revisions.value.version || (!draft.versionCode.trim() || !draft.businessOwnerUid) || !draft.reason.trim()) return
  saving.value = true
  saveError.value = null
  const body = { ...draft, expectedRevision: revisions.value.workspace, expectedVersionRevision: revisions.value.version }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  try {
    if (!(await confirm({ title: '保存版本信息', message: `当前版本：${data.value?.version_code}\n业务负责人 UID：${draft.businessOwnerUid}\n保存版本号：${draft.versionCode}\n名称：${draft.name || '无'}\n计划发布：${draft.plannedReleaseDate || '待安排'}\n说明：${draft.description || '无'}\n原因：${draft.reason}`, confirmLabel: '保存修改' }))) return
    const response = await $fetch<{ code: number }>(endpoint.value, { method: 'PATCH', body, headers: { 'Idempotency-Key': retry.key } })
    if (response.code !== 0) throw new Error('保存结果不完整，请重试')
    editing.value = false
    retry = undefined
    toast.add({ title: '版本信息已更新', color: 'success' })
    await Promise.all([refresh(), refreshPermission()])
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('修改失败，请重试')
  } finally {
    saving.value = false
  }
}
watch([code, id], () => {
  deletionDraft.value = null
  deletionReason.value = ''
  deletionError.value = null
  deletionRetry = undefined
  archiveDraft.value = null
  archiveReason.value = ''
  archiveError.value = null
  archiveRetry = undefined
  reopenDraft.value = null
  reopenedRecord.value = null
  reopenReason.value = ''
  reopenError.value = null
  reopenRetry = undefined
  editing.value = false
  Object.assign(draft, { versionCode: '', name: '', description: '', plannedReleaseDate: '', businessOwnerUid: '', reason: '' })
  retry = undefined
  saveError.value = null
  revisions.value = { workspace: 0, version: 0 }
})
onBeforeRouteLeave(() => !saving.value && !reloading.value)
onBeforeRouteUpdate(() => !saving.value && !reloading.value)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap gap-2">
      <UButton
        color="neutral"
        variant="outline"
        :loading="reloading"
        :disabled="saving"
        @click="reload"
      >
        重新读取
      </UButton>
      <ProductsVersionDevelopmentAction
        v-if="data"
        :key="`${code}:${id}`"
        :product-code="code"
        :version="data"
        :can-edit="canEdit"
        :disabled="saving || reloading"
        @busy="saving = $event"
        @saved="reload"
      />
      <UButton
        v-if="canDelete"
        color="error"
        variant="outline"
        :disabled="saving || reloading"
        @click="startDelete"
      >
        删除规划版本
      </UButton>
      <UButton v-if="canEdit" :disabled="saving || reloading" @click="start">
        编辑版本信息
      </UButton>
    </div>
    <UButton :to="{ path: moduleUrl(`/products/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/acceptances`), query: versionPerspectiveQuery }" color="neutral" variant="outline">
      查看验收记录
    </UButton>
    <UButton
      v-if="data?.current_release_record_id"
      :to="{ path: moduleUrl(`/products/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/releases/${data.current_release_record_id}`), query: versionPerspectiveQuery }"
      color="primary"
      variant="outline"
    >
      查看冻结的发布快照
    </UButton>
    <p v-if="data?.current_release_record_id" class="text-sm text-muted">
      此页为当前版本信息；发布时的正式内容请查看发布快照。
    </p>
    <UButton
      v-if="canReopen"
      color="warning"
      variant="outline"
      :disabled="saving || reloading"
      @click="startReopen"
    >
      撤回并重新开发
    </UButton>
    <UButton
      v-if="canArchive"
      color="warning"
      variant="outline"
      :disabled="saving || reloading"
      @click="startArchive"
    >
      归档版本
    </UButton>
    <UAlert v-if="reopenedRecord" color="success" title="版本已回到开发中，请重新验收后发布更正" />
    <UButton
      v-if="reopenedRecord"
      :to="{ path: moduleUrl(`/products/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/releases/${reopenedRecord}`), query: versionPerspectiveQuery }"
      color="neutral"
      variant="outline"
    >
      查看已撤回的原发布快照
    </UButton>
    <UButton :to="{ path: moduleUrl(`/products/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/releases`), query: versionPerspectiveQuery }" color="neutral" variant="outline">
      查看发布历史
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <p v-if="status === 'pending'" role="status">
      正在加载版本详情…
    </p>
    <article v-if="status === 'success' && data" class="min-w-0 space-y-3 rounded-lg border border-default p-4">
      <h1 class="break-words text-xl font-semibold">
        {{ data.version_code }}{{ data.name ? ` · ${data.name}` : '' }}
      </h1>
      <UBadge color="neutral" variant="subtle">
        {{ states[data.status] }}
      </UBadge>
      <p class="text-sm text-muted">
        业务负责人 UID：{{ data.business_owner_uid || '未指定' }}
      </p>
      <p class="text-sm text-muted">
        计划发布：{{ data.planned_release_date || '待安排' }}
      </p>
      <p class="whitespace-pre-wrap break-words">
        {{ data.description || '暂无说明' }}
      </p>
    </article>
    <UModal
      v-model:open="deletionOpen"
      title="版本删除"
      description="仅可删除无引用的规划版本，删除后不可恢复。"
      :dismissible="!saving && !reloading"
      :close="!saving && !reloading"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="removeVersion">
          <UAlert v-if="deletionAlert" v-bind="deletionAlert" />
          <p class="break-words">
            {{ deletionDraft?.name }} · 规划中 → 删除
          </p>
          <UFormField label="删除原因" required>
            <UTextarea
              v-model="deletionReason"
              required
              :maxlength="2000"
              :disabled="saving || reloading"
              class="w-full"
            />
          </UFormField>
          <p v-if="deletionError" class="text-sm text-muted">
            原因已保留。若版本已变化，请复制原因、关闭窗口并重新读取后操作。
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton type="submit" :loading="saving" :disabled="reloading || !canDelete || !deletionReason.trim()">
              确认删除
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="saving || reloading"
              @click="deletionDraft = null"
            >
              取消
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
    <UModal
      v-model:open="archiveOpen"
      title="版本归档"
      description="归档后保留发布快照和范围历史。"
      :dismissible="!saving && !reloading"
      :close="!saving && !reloading"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="archive">
          <UAlert v-if="archiveAlert" v-bind="archiveAlert" />
          <p class="break-words">
            {{ archiveDraft?.name }} · 已发布 → 已归档
          </p>
          <UFormField label="归档原因" required>
            <UTextarea
              v-model="archiveReason"
              required
              :maxlength="2000"
              :disabled="saving || reloading"
              class="w-full"
            />
          </UFormField>
          <p v-if="archiveError" class="text-sm text-muted">
            原因已保留。若版本已变化，请复制原因、关闭窗口并重新读取后操作。
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton type="submit" :loading="saving" :disabled="reloading || !canArchive || !archiveReason.trim()">
              确认归档
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="saving || reloading"
              @click="archiveDraft = null"
            >
              取消
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
    <UModal
      v-model:open="reopenOpen"
      title="撤回并重新开发"
      description="原发布内容保留，旧验收不再满足新发布条件。"
      :dismissible="!saving && !reloading"
      :close="!saving && !reloading"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="reopen">
          <UAlert v-if="reopenAlert" v-bind="reopenAlert" />
          <p class="break-words">
            {{ reopenDraft?.name }} · 发布记录 #{{ reopenDraft?.record }}
          </p>
          <UFormField label="撤回重开原因" required>
            <UTextarea
              v-model="reopenReason"
              required
              :maxlength="2000"
              :disabled="saving || reloading"
              class="w-full"
            />
          </UFormField>
          <p v-if="reopenError" class="text-sm text-muted">
            原因已保留。若信息已变化，请复制原因、关闭窗口并重新读取后操作。
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton
              type="submit"
              color="warning"
              :loading="saving"
              :disabled="reloading || !canReopen || !reopenReason.trim()"
            >
              确认撤回重开
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="saving || reloading"
              @click="reopenDraft = null"
            >
              取消
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
    <UModal
      v-model:open="editing"
      title="编辑版本信息"
      description="修改基本信息并记录原因。刷新后输入会保留，请对照最新详情确认修改。"
      :dismissible="!saving && !reloading"
      :close="!saving && !reloading"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="save">
          <UAlert v-if="saveAlert" v-bind="saveAlert" />
          <UFormField label="业务负责人" required>
            <UserTreeSelector
              :model-value="draft.businessOwnerUid ? [draft.businessOwnerUid] : []"
              selection-mode="single"
              :disabled="saving"
              @update:model-value="(uids) => { draft.businessOwnerUid = uids[0] || '' }"
            />
            <p class="mt-1 text-sm text-muted">
              请选择有效产品成员；负责人仍需具备版本验收权限。
            </p>
          </UFormField>
          <UFormField label="版本号" required>
            <UInput
              v-model="draft.versionCode"
              required
              :maxlength="64"
              :disabled="saving || reloading"
              class="w-full"
            />
          </UFormField>
          <UFormField label="版本名称">
            <UInput
              v-model="draft.name"
              :maxlength="200"
              :disabled="saving || reloading"
              class="w-full"
            />
          </UFormField>
          <UFormField label="计划发布日期">
            <UInput
              v-model="draft.plannedReleaseDate"
              type="date"
              min="1000-01-01"
              max="9999-12-31"
              :disabled="saving || reloading"
              class="w-full"
            />
          </UFormField>
          <UFormField label="版本说明">
            <UTextarea
              v-model="draft.description"
              :maxlength="10000"
              :disabled="saving || reloading"
              class="w-full"
            />
          </UFormField>
          <UFormField label="修改原因" required>
            <UTextarea
              v-model="draft.reason"
              required
              :maxlength="2000"
              :disabled="saving || reloading"
              class="w-full"
            />
          </UFormField>
          <div class="flex flex-wrap gap-2">
            <UButton type="submit" :loading="saving" :disabled="reloading || !canEdit || (!draft.versionCode.trim() || !draft.businessOwnerUid) || !draft.reason.trim() || !revisions.workspace || !revisions.version">
              保存修改
            </UButton>
            <UButton
              v-if="saveError"
              color="neutral"
              variant="outline"
              :loading="reloading"
              :disabled="saving"
              @click="reload"
            >
              重新读取
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="saving || reloading"
              @click="editing = false"
            >
              取消
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
