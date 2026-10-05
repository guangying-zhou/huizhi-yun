<script setup lang="ts">
import type { ProductVersionScope as Scope } from '~/types/productVersionScope'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '版本研发交付', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const versionPerspectiveQuery = computed(() => route.query.view === 'gtm' ? { view: 'gtm' } : {})
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.versionId || ''))
const base = computed(() => `/api/v1/products/${encodeURIComponent(code.value)}/versions/${encodeURIComponent(id.value)}`)
const states = { planned: '计划中', delivered: '已交付', deferred: '已顺延' }
const changes = { new: '新增能力', enhancement: '功能增强', fix: '修复', retirement: '能力退役' }

const page = ref(1), pageSize = 20
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const query = computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined }))
const { data, status, error, refresh } = await useFetch(() => `${base.value}/features`, { server: false, query, transform: (response: { code: number, data: { items: Scope[], total: number, version_revision: number, scope_revision: number, workspace_revision: number } }) => {
  if (!Number.isSafeInteger(response.data?.version_revision) || response.data.version_revision < 1 || response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.items.some(item => !Number.isSafeInteger(item.id) || item.id < 1 || String(item.version_id) !== id.value || !Object.hasOwn(states, item.status) || (item.change_type !== null && !Object.hasOwn(changes, item.change_type)) || typeof item.legacy_unscored !== 'boolean')) throw new Error('版本范围响应不完整')
  return response.data
} })
const alert = useApiErrorAlert(error, { fallbackTitle: '版本范围加载失败' })
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, status: string, scope_create: boolean, accept: boolean, edit: boolean } }>(() => `/api/v1/products/${encodeURIComponent(code.value)}/versions/permissions`, { server: false })
const { data: version, status: versionStatus, error: versionError, refresh: refreshVersion } = await useFetch<{ code: number, data: { id: number, product_code: string, version_code: string, planning_mode: 'simple' | 'cycle', status: string, revision: number, workspace_revision: number, current_release_record_id: number | null } }>(base, { server: false })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '范围编辑权限加载失败' })
const versionAlert = useApiErrorAlert(versionError, { fallbackTitle: '版本状态加载失败' })
const canMutateScope = computed(() => status.value === 'success' && permissionStatus.value === 'success' && versionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data?.product_code === code.value && permission.value.data.status === 'active' && version.value?.code === 0 && String(version.value.data?.id) === id.value && version.value.data.product_code === code.value && ['planning', 'developing'].includes(version.value.data.status) && version.value.data.current_release_record_id === null)
const { data: handoffPermission, error: handoffPermissionError, refresh: refreshHandoffPermission } = await useFetch<{ code: number, data: { product_code: string, status: string, handoff: boolean } }>(() => `/api/v1/products/${encodeURIComponent(code.value)}/planning-items/permissions`, { server: false })
const handoffPermissionAlert = useApiErrorAlert(handoffPermissionError, { fallbackTitle: '项目承接权限加载失败' })
const canHandoff = computed(() => canMutateScope.value && handoffPermission.value?.code === 0 && handoffPermission.value.data.product_code === code.value && handoffPermission.value.data.status === 'active' && handoffPermission.value.data.handoff === true)
const canEdit = computed(() => canMutateScope.value && permission.value?.data.scope_create === true)
const legacyDraft = ref<{ scope: Scope, workspace: number, version: number, revision: number } | null>(null)
const canEditLegacy = computed(() => canMutateScope.value && permission.value?.data.edit === true)
const legacyOpen = computed({ get: () => legacyDraft.value !== null, set: (value: boolean) => {
  if (!value && !busy.value) legacyDraft.value = null
} })
function startLegacy(item: Scope) {
  if (!canEditLegacy.value || permission.value?.data.edit !== true || busy.value || !data.value || item.status !== 'planned' || !item.legacy_unscored || item.planning_item_biz_id || version.value?.data.current_release_record_id != null || ![data.value.workspace_revision, data.value.scope_revision, data.value.version_revision].every(value => Number.isSafeInteger(value) && value > 0)) return
  legacyDraft.value = { scope: { ...item }, workspace: data.value.workspace_revision, version: data.value.version_revision, revision: data.value.scope_revision }
}
async function legacySaved() {
  legacyDraft.value = null
  await reload()
}
const editing = ref<{ scope: Scope, revision: number } | null>(null)
const busy = ref(false)
const historyID = ref<number | null>(null)
const delivery = ref<{ scope: Scope, versionRevision: number, scopeRevision: number, workspaceRevision: number } | null>(null)
const deliveryMode = ref<'deliver' | 'reopen'>('deliver')
const evidence = ref(''), deliveryReason = ref('')
const deliveryError = ref<Error | null>(null)
const deliveryAlert = useApiErrorAlert(deliveryError, { fallbackTitle: '交付确认失败' })
const canDeliver = computed(() => canMutateScope.value && permission.value?.data.accept === true)
const deliveryOpen = computed({ get: () => delivery.value !== null, set: (value: boolean) => {
  if (!value && !busy.value) delivery.value = null
} })
let deliveryRetry: { payload: string, key: string } | undefined
const { confirm } = useConfirm()
const toast = useToast()
function startReopen(item: Scope) {
  if (!canDeliver.value || version.value?.data.current_release_record_id != null || busy.value || !data.value || item.status !== 'delivered' || !Number.isSafeInteger(data.value.scope_revision) || data.value.scope_revision < 1 || !Number.isSafeInteger(data.value.workspace_revision) || data.value.workspace_revision < 1) return
  deliveryMode.value = 'reopen'
  delivery.value = { scope: { ...item }, versionRevision: data.value.version_revision, scopeRevision: data.value.scope_revision, workspaceRevision: data.value.workspace_revision }
  evidence.value = ''
  deliveryReason.value = ''
  deliveryError.value = null
  deliveryRetry = undefined
}
function startDelivery(item: Scope) {
  if (!canDeliver.value || busy.value || !data.value || item.status !== 'planned' || !item.acceptance_criteria?.trim() || !Number.isSafeInteger(data.value.scope_revision) || data.value.scope_revision < 1 || !Number.isSafeInteger(data.value.workspace_revision) || data.value.workspace_revision < 1) return
  deliveryMode.value = 'deliver'
  delivery.value = { scope: { ...item }, versionRevision: data.value.version_revision, scopeRevision: data.value.scope_revision, workspaceRevision: data.value.workspace_revision }
  evidence.value = ''
  deliveryReason.value = ''
  deliveryError.value = null
  deliveryRetry = undefined
}
async function deliver() {
  if (busy.value || !delivery.value || !canDeliver.value || (deliveryMode.value === 'deliver' && !evidence.value.trim()) || !deliveryReason.value.trim()) return
  busy.value = true
  deliveryError.value = null
  const selected = delivery.value
  const body = { expectedRevision: selected.workspaceRevision, expectedVersionRevision: selected.versionRevision, expectedScopeRevision: selected.scopeRevision, ...(deliveryMode.value === 'deliver' ? { evidence: evidence.value } : {}), reason: deliveryReason.value }
  const payload = JSON.stringify({ mode: deliveryMode.value, scopeID: selected.scope.id, body })
  if (deliveryRetry?.payload !== payload) deliveryRetry = { payload, key: crypto.randomUUID() }
  let completed = false
  try {
    const confirmation = deliveryMode.value === 'reopen'
      ? { title: '撤回范围交付确认', message: `范围：${selected.scope.title}\n原因：${body.reason}\n范围将退回计划中，原交付证据保留。范围版本将变化，版本整体验收需要重新核验。`, confirmLabel: '撤回交付确认', tone: 'danger' as const }
      : { title: '确认范围已交付', message: `范围：${selected.scope.title}\n验收标准：${selected.scope.acceptance_criteria}\n验收依据：${body.evidence}\n原因：${body.reason}\n确认后该范围将标为已交付，版本仍需单独验收和发布。`, confirmLabel: '确认已交付', tone: 'warning' as const }
    if (!await confirm(confirmation)) return
    const response = await $fetch<{ code: number, data: { value: { id: number, version_id: number, status: string } } }>(`${base.value}/features/${selected.scope.id}/${deliveryMode.value}`, { method: 'POST', body, headers: { 'Idempotency-Key': deliveryRetry.key } })
    if (response.code !== 0 || response.data?.value?.id !== selected.scope.id || response.data.value.version_id !== selected.scope.version_id || response.data.value.status !== (deliveryMode.value === 'reopen' ? 'planned' : 'delivered')) throw new Error('确认结果不完整，请使用原请求重试')
    completed = true
    delivery.value = null
    deliveryRetry = undefined
    toast.add({ title: deliveryMode.value === 'reopen' ? '已撤回范围交付确认' : '范围已确认交付', color: 'success' })
  } catch (cause) {
    deliveryError.value = cause instanceof Error ? cause : new Error('交付确认失败')
  } finally {
    busy.value = false
  }
  if (completed) await reload()
}

const open = computed({ get: () => editing.value !== null, set: (value: boolean) => {
  if (!value && !busy.value) editing.value = null
} })
function edit(item: Scope) {
  if (!canEdit.value || busy.value || !data.value || item.status !== 'planned' || !item.planning_item_biz_id || item.legacy_unscored) return
  editing.value = { scope: { ...item }, revision: data.value.version_revision }
}
async function reload() {
  if (busy.value) return
  await Promise.all([refresh(), refreshPermission(), refreshVersion(), refreshHandoffPermission()])
}
async function saved() {
  editing.value = null
  await reload()
}
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)

watch([code, id], () => {
  legacyDraft.value = null
  historyID.value = null
  editing.value = null
  delivery.value = null
  deliveryRetry = undefined
  page.value = 1
  search.value = ''
})
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6">
    <section id="version-delivery" class="scroll-mt-4 space-y-3 rounded-lg border border-default p-4">
      <h1 class="text-lg font-semibold">
        研发交付
      </h1>
      <p class="text-sm text-muted">
        查看当前版本的执行项目与进度，再逐项确认范围交付。项目统计按已关联执行目标汇总；转交项目需求后，需建立执行目标才能计入此处。
      </p>
      <ProductsVersionDevelopmentAction
        v-if="version?.code === 0"
        :key="`${code}:${id}`"
        :product-code="code"
        :version="version.data"
        :can-edit="canEditLegacy"
        :disabled="busy"
        @busy="busy = $event"
        @saved="reload"
      />
      <ProductsVersionDeliverySummary :key="`${code}:${id}`" :product-code="code" :version-id="Number(id)" />
    </section>
    <div id="delivery-scope" class="scroll-mt-4 flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-semibold">
        范围交付与验收依据
      </h2>
      <UButton
        :to="{ path: `/products/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/acceptance`, query: versionPerspectiveQuery }"
        color="neutral"
        variant="outline"
        trailing-icon="i-lucide-arrow-right"
      >
        下一步：验收发布
      </UButton>
    </div>
    <p class="text-sm text-muted">
      交付状态与研发任务完成率分别管理。需要安排承接项目时，从对应范围转交项目需求。
    </p>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="flush">
      <UFormField label="搜索版本范围" class="min-w-0 flex-1">
        <UInput v-model="search" placeholder="范围标题或说明" class="w-full" />
      </UFormField>
      <UButton color="neutral" variant="outline" @click="reload">
        重新读取
      </UButton>
    </form>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <UAlert v-if="versionAlert" v-bind="versionAlert" />
    <UAlert v-if="handoffPermissionAlert" v-bind="handoffPermissionAlert" />
    <p v-if="status === 'pending'" role="status">
      正在加载版本范围…
    </p>
    <template v-if="status === 'success' && data">
      <CommonEmptyState
        v-if="!data.items.length"
        icon="i-lucide-list-checks"
        title="暂无符合条件的版本范围"
        description="调整搜索条件，或返回需求范围安排本次要交付的内容。"
      />
      <article v-for="item in data.items" :key="item.id" class="min-w-0 space-y-3 rounded-lg border border-default p-4">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="min-w-0 break-words font-medium">
            {{ item.title }}
          </h2>
          <UBadge color="neutral" variant="subtle">
            {{ states[item.status] }}
          </UBadge>
          <UBadge v-if="item.change_type" color="neutral" variant="outline">
            {{ changes[item.change_type] }}
          </UBadge>
          <UBadge v-if="item.legacy_unscored" color="warning" variant="subtle">
            历史范围 · 未关联评估事项
          </UBadge>
        </div>
        <p class="whitespace-pre-wrap break-words text-sm">
          {{ item.description || '暂无范围说明' }}
        </p>
        <div class="space-y-1">
          <h3 class="text-sm font-medium">
            验收标准
          </h3>
          <p class="whitespace-pre-wrap break-words text-sm text-muted">
            {{ item.acceptance_criteria || '未记录验收标准' }}
          </p>
        </div>
        <p v-if="item.deferred_from_scope_id && item.deferred_from_version_id" class="break-words text-sm text-muted">
          顺延自 {{ item.deferred_from_version_code }} · 范围 #{{ item.deferred_from_scope_id }}
        </p>
        <div v-if="item.successors?.length" class="min-w-0 space-y-2">
          <p class="text-sm font-medium">
            后续承接范围
          </p>
          <UButton
            v-for="successor in item.successors"
            :key="successor.scope_id"
            :to="{ path: `/products/${encodeURIComponent(code)}/versions/${successor.version_id}/features`, query: versionPerspectiveQuery }"
            color="neutral"
            variant="outline"
            size="sm"
          >
            {{ successor.version_code }} · 范围 #{{ successor.scope_id }}
          </UButton>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="item.deferred_from_scope_id && item.deferred_from_version_id"
            :to="{ path: `/products/${encodeURIComponent(code)}/versions/${item.deferred_from_version_id}/features`, query: versionPerspectiveQuery }"
            color="neutral"
            variant="outline"
            size="sm"
          >
            查看原版本范围
          </UButton>
          <UButton
            v-if="canDeliver && item.status === 'planned' && item.acceptance_criteria?.trim()"
            color="neutral"
            variant="outline"
            size="sm"
            @click="startDelivery(item)"
          >
            确认交付
          </UButton>
          <UButton
            v-if="canDeliver && item.status === 'delivered' && version?.data.current_release_record_id == null"
            color="warning"
            variant="outline"
            size="sm"
            :disabled="busy"
            @click="startReopen(item)"
          >
            撤回交付确认
          </UButton>
          <UButton
            v-if="canEditLegacy && permission?.data.edit && item.status === 'planned' && item.legacy_unscored && !item.planning_item_biz_id && version?.data.current_release_record_id == null"
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="busy"
            @click="startLegacy(item)"
          >
            补录验收标准
          </UButton>
          <UButton
            v-if="canEdit && item.status === 'planned' && item.planning_item_biz_id && !item.legacy_unscored"
            color="neutral"
            variant="outline"
            size="sm"
            @click="edit(item)"
          >
            编辑范围
          </UButton>
          <ProductsVersionScopeVisibility
            v-if="canEditLegacy && typeof item.is_public === 'boolean'"
            :key="`${item.id}:${data.workspace_revision}`"
            :product-code="code"
            :version-id="id"
            :scope-id="item.id"
            :is-public="item.is_public"
            :workspace-revision="data.workspace_revision"
            :version-revision="data.version_revision"
            :scope-revision="data.scope_revision"
            :disabled="busy"
            @busy="busy = $event"
            @saved="reload"
          />
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="busy"
            :aria-expanded="historyID === item.id"
            @click="historyID = historyID === item.id ? null : item.id"
          >
            {{ historyID === item.id ? '收起交付历史' : '查看交付历史' }}
          </UButton>
          <UButton
            v-if="canHandoff && item.planning_item_biz_id && item.status === 'planned'"
            :to="{ path: `/products/${encodeURIComponent(code)}/planning-items/${encodeURIComponent(item.planning_item_biz_id)}/handoff`, query: version?.data.planning_mode === 'simple' ? { versionId: id, scopeId: item.id } : {} }"
            color="neutral"
            variant="outline"
            size="sm"
          >
            转交项目需求
          </UButton>
          <UButton
            v-if="item.planning_item_biz_id"
            :to="`/products/${encodeURIComponent(code)}/planning-items/${encodeURIComponent(item.planning_item_biz_id)}`"
            color="neutral"
            variant="outline"
            size="sm"
          >
            查看规划事项
          </UButton>
          <UButton
            v-if="item.product_feature_biz_id"
            :to="`/products/${encodeURIComponent(code)}/features/${encodeURIComponent(item.product_feature_biz_id)}`"
            color="neutral"
            variant="outline"
            size="sm"
          >
            查看长期功能
          </UButton>
        </div>
        <ProductsVersionScopeHistory
          v-if="historyID === item.id"
          :key="`${code}:${id}:${item.id}:${data.scope_revision}`"
          :product-code="code"
          :version-id="id"
          :scope-id="item.id"
        />
      </article>
      <p class="text-sm text-muted">
        共 {{ data.total }} 项范围
      </p>
      <UPagination
        v-if="data.total > pageSize"
        v-model:page="page"
        :total="data.total"
        :items-per-page="pageSize"
        :sibling-count="0"
      />
    </template>
    <UModal
      v-model:open="legacyOpen"
      title="补录历史范围验收标准"
      description="只更新已有历史范围的标准，保留未评估属性。"
      :dismissible="!busy"
      :close="!busy"
    >
      <template #body>
        <ProductsLegacyScopeCriteriaForm
          v-if="legacyDraft"
          :key="`${code}:${id}:${legacyDraft.scope.id}`"
          :product-code="code"
          :version-id="id"
          :scope-id="legacyDraft.scope.id"
          :title="legacyDraft.scope.title"
          :criteria="legacyDraft.scope.acceptance_criteria"
          :workspace-revision="legacyDraft.workspace"
          :version-revision="legacyDraft.version"
          :scope-revision="legacyDraft.revision"
          @busy="busy = $event"
          @saved="legacySaved"
          @cancel="legacyOpen = false"
        />
      </template>
    </UModal>
    <UModal
      v-model:open="deliveryOpen"
      :title="deliveryMode === 'reopen' ? '撤回范围交付确认' : '确认范围交付'"
      :description="deliveryMode === 'reopen' ? '撤回后退回计划中，原交付证据保留，整体验收需要重新核验。' : '请记录实际验收结果及可追溯依据。'"
      :dismissible="!busy"
      :close="!busy"
    >
      <template #body>
        <form v-if="delivery" class="space-y-4" @submit.prevent="deliver">
          <p class="break-words font-medium">
            {{ delivery.scope.title }}
          </p>
          <p class="whitespace-pre-wrap break-words text-sm">
            验收标准：{{ delivery.scope.acceptance_criteria }}
          </p>
          <UAlert v-if="deliveryAlert" v-bind="deliveryAlert" />
          <p v-if="deliveryError" class="text-sm text-muted">
            输入已保留。如范围已变化，请复制依据后关闭弹窗，重新读取当前范围再确认。
          </p>
          <UFormField v-if="deliveryMode === 'deliver'" label="验收依据" required>
            <UTextarea
              v-model="evidence"
              required
              :maxlength="10000"
              :disabled="busy"
              class="w-full"
              placeholder="逐项结果、测试报告或记录编号、核验时间等"
            />
          </UFormField>
          <UFormField :label="deliveryMode === 'reopen' ? '撤回原因' : '确认原因'" required>
            <UTextarea
              v-model="deliveryReason"
              required
              :maxlength="2000"
              :disabled="busy"
              class="w-full"
            />
          </UFormField>
          <div class="flex flex-wrap gap-2">
            <UButton type="submit" :loading="busy" :disabled="!canDeliver || (deliveryMode === 'deliver' && !evidence.trim()) || !deliveryReason.trim()">
              {{ deliveryMode === 'reopen' ? '撤回交付确认' : '确认交付' }}
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="busy"
              @click="deliveryOpen = false"
            >
              取消
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
    <UModal
      v-model:open="open"
      title="编辑版本范围"
      description="记录本次范围调整及验收标准。"
      :dismissible="!busy"
      :close="!busy"
    >
      <template #body>
        <ProductsVersionScopeEditor
          v-if="editing"
          :key="`${code}:${id}:${editing.scope.id}`"
          :product-code="code"
          :scope="editing.scope"
          :version-revision="editing.revision"
          @busy="busy = $event"
          @saved="saved"
          @cancel="open = false"
        />
      </template>
    </UModal>
  </div>
</template>
