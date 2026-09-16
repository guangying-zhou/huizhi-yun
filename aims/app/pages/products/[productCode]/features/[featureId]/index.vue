<script setup lang="ts">
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '功能详情', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.featureId || ''))
const states = { candidate: '候选', active: '已生效', deprecated: '已弃用' }
interface Feature { component_id: number | null, biz_id: string, product_code: string, title: string, description: string | null, lifecycle: keyof typeof states, revision: number }
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/features/${encodeURIComponent(id.value)}`, { server: false, transform: (response: { code: number, data: Feature }) => {
  if (response.code !== 0 || (response.data?.component_id !== null && (!Number.isSafeInteger(response.data?.component_id) || response.data.component_id < 1)) || response.data?.product_code !== code.value || response.data.biz_id !== id.value || !Object.hasOwn(states, response.data.lifecycle) || !Number.isSafeInteger(response.data.revision) || response.data.revision < 1) throw new Error('功能详情响应不完整')
  return response.data
} })
const structurePath = computed(() => ({ path: `/products/${encodeURIComponent(code.value)}/structure`, query: { module: data.value?.component_id ? String(data.value.component_id) : 'ungrouped' } }))
const alert = useApiErrorAlert(error, { fallbackTitle: '功能详情加载失败' })
interface Permission { product_code: string, status: string, edit: boolean, delete: boolean, lifecycle: boolean, revision: number }
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: Permission }>(() => `/api/v1/products/${encodeURIComponent(code.value)}/features/permissions`, { server: false })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '功能修改权限加载失败' })
const canEdit = computed(() => status.value === 'success' && data.value?.biz_id === id.value && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.edit === true && Number.isSafeInteger(permission.value.data.revision) && permission.value.data.revision > 0)
const classifying = ref<{ name: string, parentId: number | null, featureRevision: number, workspaceRevision: number } | null>(null)
function startClassification() {
  if (!canEdit.value || !data.value || !permission.value || saving.value || reloading.value) return
  classifying.value = { name: data.value.title, parentId: data.value.component_id, featureRevision: data.value.revision, workspaceRevision: permission.value.data.revision }
}
async function classified() {
  classifying.value = null
  await reload()
}
const canDelete = computed(() => status.value === 'success' && data.value?.biz_id === id.value && data.value.lifecycle === 'candidate' && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.delete === true && Number.isSafeInteger(permission.value.data.revision) && permission.value.data.revision > 0)
const deleteReason = ref('')
let deleteRetry: { payload: string, key: string } | undefined
async function removeFeature() {
  if (saving.value || reloading.value || !canDelete.value || !data.value || !permission.value || !deleteReason.value.trim()) return
  saving.value = true
  saveError.value = null
  const body = { expectedRevision: permission.value.data.revision, expectedFeatureRevision: data.value.revision, reason: deleteReason.value }
  const payload = JSON.stringify(body)
  if (deleteRetry?.payload !== payload) deleteRetry = { payload, key: crypto.randomUUID() }
  let removed = false
  try {
    if (!(await confirm({ title: '删除候选功能', message: `删除“${data.value.title}”。此操作不能撤销。已存在需求、规划或版本引用时，系统会拒绝删除。\n原因：${body.reason}`, tone: 'danger', confirmLabel: '确认删除' }))) return
    const response = await $fetch<{ code: number }>(`/api/v1/products/${encodeURIComponent(code.value)}/features/${encodeURIComponent(id.value)}`, { method: 'DELETE', body, headers: { 'Idempotency-Key': deleteRetry.key } })
    if (response.code !== 0) throw new Error('删除结果不完整，请重试')
    removed = true
    toast.add({ title: '候选功能已删除', color: 'success' })
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('删除失败，请重试')
  } finally {
    saving.value = false
  }
  if (removed) await navigateTo(structurePath.value)
}
const draft = reactive({ title: '', description: '', reason: '' })
const editing = ref(false), saving = ref(false), reloading = ref(false)
const versions = ref({ workspace: 0, feature: 0 })
const saveError = ref<Error | null>(null)
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '功能修改失败' })
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
function bindVersions() {
  if (canEdit.value && data.value && permission.value) versions.value = { workspace: permission.value.data.revision, feature: data.value.revision }
}
function startEdit() {
  if (!canEdit.value || !data.value || saving.value || reloading.value) return
  draft.title = data.value.title
  draft.description = data.value.description || ''
  draft.reason = ''
  saveError.value = null
  retry = undefined
  bindVersions()
  editing.value = true
}
async function reload() {
  if (saving.value || reloading.value) return
  reloading.value = true
  versions.value = { workspace: 0, feature: 0 }
  try {
    await Promise.all([refresh(), refreshPermission()])
    bindVersions()
  } finally {
    reloading.value = false
  }
}
async function save() {
  if (saving.value || reloading.value || !canEdit.value || !versions.value.workspace || !versions.value.feature || !draft.title.trim() || !draft.reason.trim()) return
  saving.value = true
  saveError.value = null
  const body = { ...draft, expectedRevision: versions.value.workspace, expectedFeatureRevision: versions.value.feature }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  try {
    if (!(await confirm({ title: '确认修改功能说明', message: `当前功能：${data.value?.title}\n保存名称：${body.title}\n保存说明：${body.description || '无'}\n修改原因：${body.reason}`, confirmLabel: '保存修改' }))) return
    const response = await $fetch<{ code: number }>(`/api/v1/products/${encodeURIComponent(code.value)}/features/${encodeURIComponent(id.value)}`, { method: 'PATCH', body, headers: { 'Idempotency-Key': retry.key } })
    if (response.code !== 0) throw new Error('修改结果不完整，请重试')
    editing.value = false
    retry = undefined
    toast.add({ title: '功能说明已更新', color: 'success' })
    await Promise.all([refresh(), refreshPermission()])
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('修改失败，请重试')
  } finally {
    saving.value = false
  }
}
watch([code, id], () => {
  classifying.value = null
  editing.value = false
  deleteReason.value = ''
  deleteRetry = undefined
  draft.title = ''
  draft.description = ''
  draft.reason = ''
  retry = undefined
  saveError.value = null
  versions.value = { workspace: 0, feature: 0 }
})
onBeforeRouteLeave(() => !saving.value && !reloading.value)
onBeforeRouteUpdate(() => !saving.value && !reloading.value)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-3xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap gap-2">
      <UButton
        :to="structurePath"
        color="neutral"
        variant="ghost"
        :disabled="saving || reloading"
      >
        返回产品结构
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        :loading="reloading"
        :disabled="saving"
        @click="reload"
      >
        重新读取
      </UButton>
    </div>
    <UButton
      :to="`/products/${encodeURIComponent(code)}/features/${id}/requests`"
      color="neutral"
      variant="outline"
      :disabled="saving || reloading"
    >
      关联需求
    </UButton>
    <UButton
      v-if="canEdit && permission?.data.lifecycle"
      :to="`/products/${encodeURIComponent(code)}/features/${id}/lifecycle`"
      color="neutral"
      variant="outline"
      :disabled="saving || reloading"
    >
      管理生命周期
    </UButton>
    <UButton
      :to="`/products/${encodeURIComponent(code)}/features/${id}/roadmap`"
      color="neutral"
      variant="outline"
      :disabled="saving || reloading"
    >
      查看功能路线
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <p v-if="status === 'pending'" role="status">
      正在加载功能详情…
    </p>
    <article v-if="status === 'success' && data" class="space-y-4 rounded-lg border border-default p-4">
      <h1 class="break-words text-lg font-semibold">
        {{ data.title }}
      </h1>
      <UBadge color="neutral" variant="subtle">
        {{ states[data.lifecycle] }}
      </UBadge>
      <p class="whitespace-pre-wrap break-words">
        {{ data.description || '暂无功能说明' }}
      </p>
      <p class="text-sm text-muted">
        生命周期表示产品能力状态，不代表项目执行进度。
      </p>
    </article>
    <UButton v-if="canEdit && !editing" :disabled="saving || reloading" @click="startClassification">
      调整模块归属
    </UButton>
    <UButton v-if="canEdit && !editing" :disabled="reloading" @click="startEdit">
      修改功能说明
    </UButton>
    <form v-if="canDelete && !editing" class="space-y-3 rounded-lg border border-default p-4" @submit.prevent="removeFeature">
      <p class="text-sm text-muted">
        仅无引用的候选功能可以删除，删除前会再次检查引用关系。
      </p>
      <UAlert v-if="saveAlert" v-bind="saveAlert" />
      <UFormField label="删除原因" required>
        <UTextarea
          v-model="deleteReason"
          :disabled="saving || reloading"
          :maxlength="2000"
          class="w-full"
        />
      </UFormField>
      <UButton
        type="submit"
        color="error"
        variant="outline"
        :loading="saving"
        :disabled="reloading || !deleteReason.trim()"
      >
        删除候选功能
      </UButton>
    </form>
    <form v-if="editing" class="space-y-3 rounded-lg border border-default p-4" @submit.prevent="save">
      <p class="text-sm text-muted">
        重新读取会保留填写内容。保存前请对照上方当前功能，确认修改内容。
      </p>
      <UAlert v-if="saveAlert" v-bind="saveAlert" />
      <UFormField label="功能名称" required>
        <UInput
          v-model="draft.title"
          :disabled="saving || reloading"
          :maxlength="500"
          class="w-full"
        />
      </UFormField>
      <UFormField label="功能说明">
        <UTextarea
          v-model="draft.description"
          :disabled="saving || reloading"
          :maxlength="10000"
          class="w-full"
        />
      </UFormField>
      <UFormField label="修改原因" required>
        <UTextarea
          v-model="draft.reason"
          :disabled="saving || reloading"
          :maxlength="2000"
          class="w-full"
        />
      </UFormField>
      <div class="flex flex-wrap gap-2">
        <UButton type="submit" :loading="saving" :disabled="reloading || !canEdit || !versions.workspace || !versions.feature || !draft.title.trim() || !draft.reason.trim()">
          保存修改
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
    <UModal
      :open="!!classifying"
      title="调整功能模块归属"
      description="选择所属模块，或移回未分组。"
      :dismissible="!saving"
      :close="!saving"
      @update:open="value => { if (!value && !saving) classifying = null }"
    >
      <template #body>
        <ProductsFeatureComponentForm
          v-if="classifying"
          :product-code="code"
          :feature-biz-id="id"
          :name="classifying.name"
          :parent-id="classifying.parentId"
          :feature-revision="classifying.featureRevision"
          :workspace-revision="classifying.workspaceRevision"
          @busy="saving = $event"
          @cancel="classifying = null"
          @saved="classified"
        />
      </template>
    </UModal>
  </div>
</template>
