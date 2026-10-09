<script setup lang="ts">
import type { ProductVersionScope } from '../../app/types/productVersionScope'
import VersionDeliverySummary from '../../app/components/products/VersionDeliverySummary.vue'
import VersionScopeHistory from '../../app/components/products/VersionScopeHistory.vue'
import VersionScopeEditor from '../../app/components/products/VersionScopeEditor.vue'
import VersionScopeVisibility from '../../app/components/products/VersionScopeVisibility.vue'
import LegacyScopeCriteriaForm from '../../app/components/products/LegacyScopeCriteriaForm.vue'
import { useAimsModule } from '../useAimsModule'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '版本研发交付', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const { moduleUrl, cacheKey } = useAimsModule()
const code = computed(() => String(route.params.productCode || ''))
const versionId = computed(() => String(route.params.versionId || ''))
const base = computed(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/versions/${encodeURIComponent(versionId.value)}`))
const page = ref(1)
const pageSize = 20
const historyId = ref<number | null>(null)
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const query = computed(() => ({ page: page.value, pageSize, ...(debounced.value ? { keyword: debounced.value } : {}) }))
type ScopePage = { items: ProductVersionScope[], total: number, page: number, pageSize: number, version_revision: number, scope_revision: number, workspace_revision: number }
const states = { planned: { label: '计划中', color: 'info' }, delivered: { label: '已交付', color: 'success' }, deferred: { label: '已顺延', color: 'warning' } } as const
const changes = { new: '新增能力', enhancement: '功能增强', fix: '修复', retirement: '能力退役' } as const
const { data, status, error, refresh } = await useFetch(() => `${base.value}/features`, {
  key: computed(() => cacheKey(`version-scope:${code.value}:${versionId.value}`)),
  server: false,
  query,
  transform(response: { code: number, data: ScopePage }) {
    const value = response.data
    if (response.code !== 0 || !value || !Array.isArray(value.items) || !Number.isSafeInteger(value.total) || value.total < 0 || value.page !== page.value || value.pageSize !== pageSize || ![value.version_revision, value.scope_revision, value.workspace_revision].every(revision => Number.isSafeInteger(revision) && revision > 0) || value.items.some(item => !Number.isSafeInteger(item.id) || item.id < 1 || String(item.version_id) !== versionId.value || !Object.hasOwn(states, item.status))) throw new Error('版本范围响应不完整')
    return value
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '版本范围加载失败' })
type Permission = { code: number, data: { product_code: string, status: string, accept: boolean, edit: boolean, scope_create: boolean } }
type Version = { code: number, data: { id: number, product_code: string, status: string, planning_mode: 'simple' | 'cycle', current_release_record_id: number | null } }
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermission } = await useFetch<Permission>(() => `${moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/versions/permissions`)}`, { server: false })
const { data: version, status: versionStatus, error: versionError, refresh: refreshVersion } = await useFetch<Version>(() => base.value, { server: false })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '交付权限加载失败' })
const versionAlert = useApiErrorAlert(versionError, { fallbackTitle: '版本状态加载失败' })
const canMutateScope = computed(() => status.value === 'success' && permissionStatus.value === 'success' && versionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && version.value?.code === 0 && String(version.value.data.id) === versionId.value && version.value.data.product_code === code.value && ['planning', 'developing'].includes(version.value.data.status) && version.value.data.current_release_record_id === null)
const canDeliver = computed(() => canMutateScope.value && permission.value?.data.accept === true)
const canEditScope = computed(() => canMutateScope.value && permission.value?.data.scope_create === true && version.value?.data.planning_mode === 'cycle')
const canMaintainScope = computed(() => canMutateScope.value && permission.value?.data.edit === true)
const editing = ref<{ scope: ProductVersionScope, revision: number } | null>(null)
const legacyDraft = ref<{ scope: ProductVersionScope, workspace: number, version: number, revision: number } | null>(null)
const editOpen = computed({
  get: () => editing.value !== null,
  set: (open: boolean) => {
    if (!open && !busy.value) editing.value = null
  }
})
const legacyOpen = computed({
  get: () => legacyDraft.value !== null,
  set: (open: boolean) => {
    if (!open && !busy.value) legacyDraft.value = null
  }
})
const delivery = ref<{ scope: ProductVersionScope, versionRevision: number, scopeRevision: number, workspaceRevision: number } | null>(null)
const deliveryMode = ref<'deliver' | 'reopen'>('deliver')
const evidence = ref('')
const reason = ref('')
const deliveryError = ref<Error | null>(null)
const deliveryAlert = useApiErrorAlert(deliveryError, { fallbackTitle: '范围交付失败' })
const busy = ref(false)
let deliveryRetry: { payload: string, key: string } | undefined
const { confirm } = useConfirm()
const toast = useToast()
const deliveryOpen = computed({
  get: () => delivery.value !== null,
  set: (open: boolean) => {
    if (!open && !busy.value) delivery.value = null
  }
})
function beginDelivery(scope: ProductVersionScope, mode: 'deliver' | 'reopen') {
  if (!canDeliver.value || busy.value || !data.value || (mode === 'deliver' && (scope.status !== 'planned' || !scope.acceptance_criteria?.trim())) || (mode === 'reopen' && scope.status !== 'delivered')) return
  deliveryMode.value = mode
  delivery.value = { scope: { ...scope }, versionRevision: data.value.version_revision, scopeRevision: data.value.scope_revision, workspaceRevision: data.value.workspace_revision }
  evidence.value = ''
  reason.value = ''
  deliveryError.value = null
  deliveryRetry = undefined
}
function beginEdit(scope: ProductVersionScope) {
  if (!canEditScope.value || busy.value || !data.value || scope.status !== 'planned' || !scope.planning_item_biz_id || scope.legacy_unscored) return
  editing.value = { scope: { ...scope }, revision: data.value.version_revision }
}
function beginLegacy(scope: ProductVersionScope) {
  if (!canMaintainScope.value || busy.value || !data.value || scope.status !== 'planned' || !scope.legacy_unscored || scope.planning_item_biz_id) return
  legacyDraft.value = { scope: { ...scope }, workspace: data.value.workspace_revision, version: data.value.version_revision, revision: data.value.scope_revision }
}
async function reload() {
  await Promise.all([refresh(), refreshPermission(), refreshVersion()])
}
async function savedScope() {
  editing.value = null
  legacyDraft.value = null
  await reload()
}
async function submitDelivery() {
  if (busy.value || !delivery.value || !canDeliver.value || !reason.value.trim() || (deliveryMode.value === 'deliver' && !evidence.value.trim())) return
  const selected = delivery.value
  const body = { expectedRevision: selected.workspaceRevision, expectedVersionRevision: selected.versionRevision, expectedScopeRevision: selected.scopeRevision, ...(deliveryMode.value === 'deliver' ? { evidence: evidence.value } : {}), reason: reason.value }
  const payload = JSON.stringify({ mode: deliveryMode.value, scopeId: selected.scope.id, body })
  if (deliveryRetry?.payload !== payload) deliveryRetry = { payload, key: crypto.randomUUID() }
  const mode = deliveryMode.value
  const confirmation = mode === 'reopen'
    ? { title: '撤回范围交付确认', message: `范围：${selected.scope.title}\n原因：${body.reason}\n原交付证据会保留，版本验收需重新核验。`, confirmLabel: '撤回交付确认', tone: 'danger' as const }
    : { title: '确认范围已交付', message: `范围：${selected.scope.title}\n验收标准：${selected.scope.acceptance_criteria}\n验收依据：${body.evidence}\n确认后版本仍需单独验收和发布。`, confirmLabel: '确认已交付', tone: 'warning' as const }
  if (!await confirm(confirmation)) return
  busy.value = true
  deliveryError.value = null
  try {
    const response = await $fetch<{ code: number, data: { value: { id: number, version_id: number, status: string } } }>(`${base.value}/features/${selected.scope.id}/${mode}`, { method: 'POST', body, headers: { 'Idempotency-Key': deliveryRetry.key } })
    if (response.code !== 0 || response.data?.value?.id !== selected.scope.id || response.data.value.version_id !== selected.scope.version_id || response.data.value.status !== (mode === 'deliver' ? 'delivered' : 'planned')) throw new Error('确认结果不完整，请使用原请求重试')
    delivery.value = null
    deliveryRetry = undefined
    toast.add({ title: mode === 'deliver' ? '范围已确认交付' : '已撤回范围交付确认', color: 'success' })
    await reload()
  } catch (cause) {
    if (typeof cause === 'object' && cause !== null && ('statusCode' in cause || 'status' in cause) && (Number('statusCode' in cause ? cause.statusCode : cause.status) === 409)) {
      delivery.value = null
      deliveryRetry = undefined
      toast.add({ title: '范围已变化，请重新核验后再操作', color: 'warning' })
      await reload()
    } else {
      deliveryError.value = cause instanceof Error ? cause : new Error('范围交付失败')
    }
  } finally {
    busy.value = false
  }
}
watch([code, versionId], () => {
  page.value = 1
  search.value = ''
  historyId.value = null
  delivery.value = null
  deliveryRetry = undefined
  editing.value = null
  legacyDraft.value = null
})
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-6 p-4 sm:p-6">
    <header class="space-y-2">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-xl font-semibold">
          版本研发交付
        </h1>
      </div>
      <p class="text-sm text-muted">
        查看版本执行进度、范围与验收记录，并按权限确认交付。
      </p>
      <UButton
        :to="moduleUrl(`/products/${encodeURIComponent(code)}/versions/${encodeURIComponent(versionId)}`)"
        color="neutral"
        variant="link"
        icon="i-lucide-arrow-left"
      >
        返回版本详情
      </UButton>
    </header>

    <section id="version-delivery" class="scroll-mt-4 space-y-3 rounded-lg border border-default p-4" aria-label="执行协调汇总">
      <h2 class="font-semibold">
        执行协调汇总
      </h2>
      <VersionDeliverySummary :key="`${code}:${versionId}`" :product-code="code" :version-id="Number(versionId)" />
    </section>

    <section id="delivery-scope" class="scroll-mt-4 space-y-4" aria-label="版本范围">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="font-semibold">
            范围与验收标准
          </h2><p class="text-sm text-muted">
            按当前版本范围顺序展示。
          </p>
        </div>
        <div class="flex w-full gap-2 sm:w-auto">
          <UInput
            v-model="search"
            class="min-w-0 flex-1"
            placeholder="搜索范围标题或说明"
            aria-label="搜索版本范围"
            @keyup.enter="flush"
          />
          <UButton color="neutral" variant="outline" @click="flush">
            搜索
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            :loading="status === 'pending'"
            @click="refresh()"
          >
            刷新
          </UButton>
        </div>
      </div>
      <UAlert v-if="alert" v-bind="alert" />
      <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
      <UAlert v-if="versionAlert" v-bind="versionAlert" />
      <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
        正在读取版本范围…
      </p>
      <template v-else-if="status === 'success' && data">
        <CommonEmptyState
          v-if="!data.items.length"
          icon="i-lucide-list-checks"
          title="暂无匹配范围"
          description="调整搜索词或查看版本计划。"
        />
        <article v-for="item in data.items" :key="item.id" class="min-w-0 space-y-3 rounded-lg border border-default p-4">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="min-w-0 break-words font-medium">
              {{ item.title }}
            </h3>
            <UBadge :color="states[item.status].color" variant="subtle">
              {{ states[item.status].label }}
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
          <div>
            <h4 class="text-sm font-medium">
              验收标准
            </h4><p class="whitespace-pre-wrap break-words text-sm text-muted">
              {{ item.acceptance_criteria || '未记录验收标准' }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-if="canDeliver && item.status === 'planned' && item.acceptance_criteria?.trim()"
              size="sm"
              :disabled="busy"
              @click="beginDelivery(item, 'deliver')"
            >
              确认交付
            </UButton>
            <UButton
              v-if="canDeliver && item.status === 'delivered'"
              size="sm"
              color="warning"
              variant="soft"
              :disabled="busy"
              @click="beginDelivery(item, 'reopen')"
            >
              撤回交付
            </UButton>
            <UButton
              v-if="canEditScope && item.status === 'planned' && item.planning_item_biz_id && !item.legacy_unscored"
              size="sm"
              color="neutral"
              variant="outline"
              :disabled="busy"
              @click="beginEdit(item)"
            >
              编辑范围
            </UButton>
            <UButton
              v-if="canMaintainScope && item.status === 'planned' && item.legacy_unscored && !item.planning_item_biz_id"
              size="sm"
              color="neutral"
              variant="outline"
              :disabled="busy"
              @click="beginLegacy(item)"
            >
              补录验收标准
            </UButton>
            <VersionScopeVisibility
              v-if="canMaintainScope && typeof item.is_public === 'boolean'"
              :key="`${item.id}:${data.workspace_revision}`"
              :product-code="code"
              :version-id="versionId"
              :scope-id="item.id"
              :is-public="item.is_public"
              :workspace-revision="data.workspace_revision"
              :version-revision="data.version_revision"
              :scope-revision="data.scope_revision"
              :disabled="busy"
              @busy="busy = $event"
              @saved="reload"
            />
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-expanded="historyId === item.id"
            @click="historyId = historyId === item.id ? null : item.id"
          >
            {{ historyId === item.id ? '收起历史' : '查看范围历史' }}
          </UButton>
          <VersionScopeHistory
            v-if="historyId === item.id"
            :key="`${code}:${versionId}:${item.id}`"
            :product-code="code"
            :version-id="versionId"
            :scope-id="item.id"
          />
        </article>
        <div class="flex flex-wrap items-center gap-3 text-sm text-muted">
          <span>共 {{ data.total }} 项范围</span>
          <UPagination
            v-if="data.total > pageSize"
            v-model:page="page"
            :total="data.total"
            :items-per-page="pageSize"
            :sibling-count="0"
          />
        </div>
      </template>
    </section>
    <UModal
      v-model:open="editOpen"
      title="编辑版本范围"
      :dismissible="!busy"
      :close="!busy"
    >
      <template #body>
        <VersionScopeEditor
          v-if="editing"
          :key="`${code}:${versionId}:${editing.scope.id}`"
          :product-code="code"
          :scope="editing.scope"
          :version-revision="editing.revision"
          @busy="busy = $event"
          @saved="savedScope"
          @cancel="editOpen = false"
        />
      </template>
    </UModal>
    <UModal
      v-model:open="legacyOpen"
      title="补录历史范围验收标准"
      :dismissible="!busy"
      :close="!busy"
    >
      <template #body>
        <LegacyScopeCriteriaForm
          v-if="legacyDraft"
          :key="`${code}:${versionId}:${legacyDraft.scope.id}`"
          :product-code="code"
          :version-id="versionId"
          :scope-id="legacyDraft.scope.id"
          :title="legacyDraft.scope.title"
          :criteria="legacyDraft.scope.acceptance_criteria"
          :workspace-revision="legacyDraft.workspace"
          :version-revision="legacyDraft.version"
          :scope-revision="legacyDraft.revision"
          @busy="busy = $event"
          @saved="savedScope"
          @cancel="legacyOpen = false"
        />
      </template>
    </UModal>
    <UModal
      v-model:open="deliveryOpen"
      :title="deliveryMode === 'deliver' ? '确认范围交付' : '撤回范围交付确认'"
      :dismissible="!busy"
      :close="!busy"
    >
      <template #body>
        <form v-if="delivery" class="space-y-4" @submit.prevent="submitDelivery">
          <p class="break-words font-medium">
            {{ delivery.scope.title }}
          </p>
          <p class="whitespace-pre-wrap break-words text-sm">
            验收标准：{{ delivery.scope.acceptance_criteria }}
          </p>
          <UAlert v-if="deliveryAlert" v-bind="deliveryAlert" />
          <p v-if="deliveryError" class="text-sm text-muted">
            输入已保留。如范围已变化，请复制依据后关闭弹窗，重新读取当前范围。
          </p>
          <UFormField v-if="deliveryMode === 'deliver'" label="验收依据" required>
            <UTextarea
              v-model="evidence"
              required
              :maxlength="10000"
              :disabled="busy"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="deliveryMode === 'deliver' ? '确认原因' : '撤回原因'" required>
            <UTextarea
              v-model="reason"
              required
              :maxlength="2000"
              :disabled="busy"
              class="w-full"
            />
          </UFormField>
          <div class="flex flex-wrap gap-2">
            <UButton type="submit" :loading="busy" :disabled="!canDeliver || !reason.trim() || (deliveryMode === 'deliver' && !evidence.trim())">
              {{ deliveryMode === 'deliver' ? '确认已交付' : '撤回交付确认' }}
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
  </div>
</template>
