<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { ProductRequestRecord as RequestRow } from '~/types/productRequest'
import { normalizeProductRequestQuery } from '~/config/productNavigation'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '需求池',
  layoutHeaderProjectSwitcher: false,
  middleware: (to) => {
    const query = normalizeProductRequestQuery(to.query)
    if (query) return navigateTo({ path: to.path, query, hash: to.hash }, { replace: true })
  }
})
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))

const states: Record<string, string> = { submitted: '待评估', evaluating: '评估中', accepted: '已采纳', deferred: '暂缓', rejected: '已拒绝', merged: '已合并' }
const sources: Record<string, string> = { customer: '客户', internal: '内部', engineering: '工程治理', other: '其他' }
const { search, debounced, flush, reset: resetSearch } = useDebouncedSearch()
const decisionStatus = ref('all'), sourceType = ref('all'), urgencyLevel = ref('all')
const moduleId = ref('')
const pickedModule = ref<{ id: number | null, name: string } | null>(null)
// 页面跳转携带的名称只作显示提示；筛选和保存始终只使用 moduleId。
function moduleDisplayHint(query: Record<string, unknown>, id: string) {
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || query.moduleNameId !== id) return ''
  const name = query.moduleName
  if (typeof name !== 'string' || !name.isWellFormed() || [...name].length > 255 || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return ''
  return name.trim()
}
const moduleName = computed(() => pickedModule.value && String(pickedModule.value.id) === moduleId.value
  ? pickedModule.value.name
  : moduleDisplayHint(route.query, moduleId.value))
const includeDescendants = ref(route.query.includeDescendants === 'true')
const unassigned = ref(route.query.unassigned === 'true')
const modulePickerOpen = ref(false)
const { page, pageSize, resetFilters } = useListPage({ pageSize: 20,
  filters: { keyword: search, decisionStatus, sourceType, urgencyLevel, moduleId, includeDescendants, unassigned },
  defaults: { keyword: '', decisionStatus: 'all', sourceType: 'all', urgencyLevel: 'all', moduleId: '', includeDescendants: false, unassigned: false }
})
// 列表 URL 完成同步后移除已失配的提示，避免清空或换模块后复活旧名称。
watch(() => route.query, (value) => {
  if (!Object.hasOwn(value, 'moduleName') && !Object.hasOwn(value, 'moduleNameId')) return
  if (moduleDisplayHint(value, typeof value.moduleId === 'string' ? value.moduleId : '')) return
  const query = { ...value }
  delete query.moduleName
  delete query.moduleNameId
  void navigateTo({ path: route.path, query, hash: route.hash }, { replace: true })
}, { immediate: true, flush: 'post' })
flush()
const query = computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined,
  decisionStatus: decisionStatus.value === 'all' ? undefined : decisionStatus.value,
  sourceType: sourceType.value === 'all' ? undefined : sourceType.value,
  urgencyLevel: urgencyLevel.value === 'all' ? undefined : urgencyLevel.value,
  componentId: moduleId.value || undefined,
  includeDescendants: moduleId.value && includeDescendants.value ? 'true' : undefined,
  unassigned: unassigned.value ? 'true' : undefined
}))
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/requests`, {
  server: false, query,
  transform: (response: { code: number, data: { items: RequestRow[], total: number, unmerged_total: number, workspace_revision: number } }) => {
    if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || !Number.isSafeInteger(response.data.unmerged_total) || response.data.unmerged_total < 0 || response.data.unmerged_total > response.data.total) throw new Error('需求列表响应不完整')
    return response.data
  }
})
const { data: permissions, status: permissionStatus, error: permissionError, refresh: refreshPermissions } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/requests/permissions`, {
  server: false, transform: (response: { code: number, data: { product_code: string, status: string, revision: number, create: boolean, edit: boolean, decide: boolean, delete: boolean } }) => {
    if (response.code !== 0 || response.data?.product_code !== code.value) throw new Error('需求操作权限响应不完整')
    return response.data
  }
})
const { data: planningPermissions, status: planningPermissionStatus, error: planningPermissionError, refresh: refreshPlanningPermissions } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/planning-items/permissions`, { server: false })
const canPlan = computed(() => planningPermissionStatus.value === 'success' && planningPermissions.value?.code === 0 && planningPermissions.value.data?.product_code === code.value && planningPermissions.value.data.status === 'active' && planningPermissions.value.data.edit === true)
const planningAlert = useApiErrorAlert(planningPermissionError, { fallbackTitle: '建设范围操作权限加载失败' })
const planning = ref<{ request: RequestRow, revision: number } | null>(null)
const planningOpen = computed(() => planning.value !== null)
function openPlanning(request: RequestRow) {
  if (sourceDeleteBusy.value || !canPlan.value || !data.value || request.decision_status === 'merged') return
  planning.value = { request: { ...request }, revision: data.value.workspace_revision }
  selected.value = null
}
async function planned() {
  planning.value = null
  toast.add({ title: '建设范围已创建，可继续安排优先级', color: 'success' })
  await refreshAll()
}
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '需求操作权限加载失败' })
const writable = computed(() => permissionStatus.value === 'success' && permissions.value?.status === 'active' && status.value === 'success')
const editing = ref<{ request?: RequestRow, revision: number, initialComponentId?: number | null, initialComponentName?: string } | null>(null)
const deciding = ref<{ request: RequestRow, revision: number } | null>(null)
const addingSource = ref<{ request: RequestRow, revision: number } | null>(null)
const merging = ref<{ request: RequestRow, revision: number } | null>(null)
const mergeOpen = computed(() => merging.value !== null)
function openMerge(request: RequestRow) {
  if (sourceDeleteBusy.value || !writable.value || !data.value || !permissions.value?.decide || request.decision_status === 'merged') return
  selected.value = null
  merging.value = { request, revision: data.value.workspace_revision }
}
const sourceOpen = computed(() => addingSource.value !== null)
function openSource(request: RequestRow) {
  if (sourceDeleteBusy.value || !writable.value || !data.value || !permissions.value?.edit || request.decision_status === 'merged') return
  selected.value = null
  addingSource.value = { request, revision: data.value.workspace_revision }
}
const decisionOpen = computed(() => deciding.value !== null)
function openDecision(request: RequestRow) {
  if (sourceDeleteBusy.value || !writable.value || !data.value || !permissions.value?.decide || !['submitted', 'evaluating', 'accepted', 'deferred'].includes(request.decision_status)) return
  selected.value = null
  deciding.value = { request, revision: data.value.workspace_revision }
}
const formOpen = computed(() => editing.value !== null)
const createIntent = ref('')
function openForm(request?: RequestRow) {
  if (sourceDeleteBusy.value || !writable.value || !data.value || (request ? !permissions.value?.edit || request.decision_status === 'merged' : !permissions.value?.create)) return
  selected.value = null
  editing.value = { request, revision: data.value.workspace_revision, initialComponentId: request ? request.component_id : (moduleId.value ? Number(moduleId.value) : null), initialComponentName: request ? request.component_name || '' : moduleName.value }
}
watch([code, writable, moduleId, () => route.query.create], () => {
  const intent = JSON.stringify([code.value, moduleId.value])
  if (route.query.create !== 'true') {
    createIntent.value = ''
    return
  }
  if (createIntent.value === intent || !writable.value || !permissions.value?.create) return
  createIntent.value = intent
  openForm()
  const query = { ...route.query }
  delete query.create
  void navigateTo({ path: route.path, query, hash: route.hash }, { replace: true })
}, { immediate: true })
const scheduling = ref<RequestRow | null>(null)
const selectedVersion = ref<{ id: number, product_code: string, version_code: string, name: string | null, status: string, revision: number } | null>(null)
function schedule(request: RequestRow) {
  if (sourceDeleteBusy.value || !canPlan.value || request.decision_status === 'merged') return
  scheduling.value = request
  selected.value = null
  selectedVersion.value = null
}
async function continueSchedule() {
  if (!scheduling.value || !selectedVersion.value) return
  await navigateTo({ path: `/products/${encodeURIComponent(code.value)}/versions/${selectedVersion.value.id}/plan`, query: { addRequest: scheduling.value.biz_id } })
}
const toast = useToast()
async function refreshAll() {
  if (sourceDeleteBusy.value) return
  selected.value = null
  await Promise.all([refresh(), refreshPermissions(), refreshPlanningPermissions()])
}
async function saved() {
  toast.add({ title: '需求已保存', color: 'success' })
  merging.value = null
  addingSource.value = null
  deciding.value = null
  editing.value = null
  selected.value = null
  await Promise.all([refresh(), refreshPermissions(), refreshPlanningPermissions()])
}
const alert = useApiErrorAlert(error, { fallbackTitle: '需求池加载失败' })
const selected = ref<RequestRow | null>(null)
const sourceDeleteBusy = ref(false)
const detailHistory = ref<RequestRow[]>([])
function showMergedSource(request: RequestRow) {
  if (sourceDeleteBusy.value || !selected.value || request.product_code !== code.value) return
  detailHistory.value.push(selected.value)
  selected.value = request
}
function backToMergeTarget() {
  if (sourceDeleteBusy.value) return
  const previous = detailHistory.value.pop()
  if (previous) selected.value = previous
}
watch(selected, (value) => {
  if (!value) detailHistory.value = []
})
const detailOpen = computed({ get: () => selected.value !== null, set: (open: boolean) => {
  if (!open && !sourceDeleteBusy.value) selected.value = null
} })
watch([code, query], () => {
  selected.value = null
})
watch(code, () => {
  pickedModule.value = null
  createIntent.value = ''
})
const columns: TableColumn<RequestRow>[] = [
  { accessorKey: 'title', header: '需求' }, { accessorKey: 'decision_status', header: '产品决定' },
  { accessorKey: 'component_name', header: '所属模块' }, { accessorKey: 'urgency_level', header: '建议紧急程度' }, { accessorKey: 'source_type', header: '来源' }
]
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refreshAll))
onBeforeUnmount(clearRefresh)
</script>

<template>
  <div class="min-w-0 space-y-4 p-4 sm:p-6">
    <section aria-label="需求推进" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default p-3">
      <div class="min-w-0">
        <h2 class="text-sm font-medium">
          从需求到交付
        </h2>
        <p class="mt-1 text-sm text-muted">
          收集与评审需求后直接排入版本，补齐范围、投入与验收标准，再确认进入研发交付。
        </p>
      </div>
      <UButton
        :to="`/products/${encodeURIComponent(code)}/versions`"
        icon="i-lucide-package"
        color="neutral"
        variant="outline"
      >
        查看版本计划
      </UButton>
    </section>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="flush">
      <UFormField label="搜索需求" name="keyword" class="min-w-0 flex-1 basis-56">
        <UInput
          v-model="search"
          placeholder="标题或问题说明"
          icon="i-lucide-search"
          class="w-full"
        />
      </UFormField>
      <UFormField label="产品决定" name="decisionStatus">
        <USelect v-model="decisionStatus" :items="[{ label: '全部决定', value: 'all' }, ...Object.entries(states).map(([value, label]) => ({ value, label }))]" />
      </UFormField>
      <UFormField label="来源" name="sourceType">
        <USelect v-model="sourceType" :items="[{ label: '全部来源', value: 'all' }, ...Object.entries(sources).map(([value, label]) => ({ value, label }))]" />
      </UFormField>
      <UFormField label="建议紧急程度" name="urgencyLevel">
        <USelect v-model="urgencyLevel" :items="[{ label: '全部等级', value: 'all' }, ...['P0', 'P1', 'P2', 'P3'].map(value => ({ value, label: value }))]" />
      </UFormField>
      <UFormField label="所属模块">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-muted">{{ moduleId ? moduleName || `模块 #${moduleId}` : unassigned ? '未分类' : '全部模块' }}</span>
          <UButton
            type="button"
            size="sm"
            color="neutral"
            variant="outline"
            @click="modulePickerOpen = true"
          >
            选择模块
          </UButton>
        </div>
      </UFormField>
      <UCheckbox v-if="moduleId" v-model="includeDescendants" label="包含子模块" />
      <UCheckbox
        v-model="unassigned"
        label="仅未分类"
        :disabled="!!moduleId"
        @update:model-value="value => { if (value) moduleId = '' }"
      />
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        @click="resetSearch(); resetFilters(); pickedModule = null"
      >
        重置
      </UButton>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        :loading="status === 'pending'"
        @click="refreshAll"
      >
        刷新需求
      </UButton>
    </form>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <UAlert v-if="planningAlert" v-bind="planningAlert" />
    <UButton v-if="writable && permissions?.create" icon="i-lucide-plus" @click="openForm()">
      新增需求
    </UButton>
    <UModal
      :open="formOpen"
      :dismissible="false"
      :close="false"
      :title="editing?.request ? '修改产品需求' : '新增产品需求'"
      :description="editing?.request ? '修改需求信息，保留已有评审决定' : '记录问题与来源，提交后进入产品评估'"
    >
      <template #body>
        <ProductsRequestForm
          v-if="editing"
          :product-code="code"
          :workspace-revision="editing.revision"
          :request="editing.request"
          :initial-component-id="editing.initialComponentId"
          :initial-component-name="editing.initialComponentName"
          @saved="saved"
          @cancel="editing = null"
        />
      </template>
    </UModal>
    <UModal v-model:open="modulePickerOpen" title="筛选需求模块" description="父模块可同时包含其全部子模块。">
      <template #body>
        <ProductsComponentPicker
          :model-value="moduleId ? Number(moduleId) : null"
          :product-code="code"
          @selected="value => { moduleId = value.id === null ? '' : String(value.id); pickedModule = value; unassigned = false; page = 1; modulePickerOpen = false }"
        />
      </template>
    </UModal>
    <UModal
      :open="decisionOpen"
      :dismissible="false"
      :close="false"
      title="产品需求评审"
      description="确认产品决定及其依据"
    >
      <template #body>
        <ProductsRequestDecisionForm
          v-if="deciding"
          :product-code="code"
          :workspace-revision="deciding.revision"
          :request="deciding.request"
          @saved="saved"
          @cancel="deciding = null"
        />
      </template>
    </UModal>
    <UModal
      :open="sourceOpen"
      :dismissible="false"
      :close="false"
      title="添加来源证据"
      description="记录人工说明、日期与证据分类"
    >
      <template #body>
        <ProductsRequestSourceForm
          v-if="addingSource"
          :product-code="code"
          :workspace-revision="addingSource.revision"
          :request="addingSource.request"
          @saved="saved"
          @cancel="addingSource = null"
        />
      </template>
    </UModal>
    <UModal
      :open="mergeOpen"
      :dismissible="false"
      :close="false"
      title="合并产品需求"
      description="选择同产品的目标需求，保留源记录与证据"
    >
      <template #body>
        <ProductsRequestMergeForm
          v-if="merging"
          :product-code="code"
          :workspace-revision="merging.revision"
          :request="merging.request"
          @saved="saved"
          @cancel="merging = null"
        />
      </template>
    </UModal>
    <UModal
      :open="planningOpen"
      :dismissible="false"
      :close="false"
      title="明确建设范围"
      description="将需求转化为本次准备建设的范围，保存后再安排周期和优先级。"
    >
      <template #body>
        <ProductsPlanningItemForm
          v-if="planning"
          :product-code="code"
          :workspace-revision="planning.revision"
          :initial-sources="[planning.request]"
          @saved="planned"
          @cancel="planning = null"
        />
      </template>
    </UModal>
    <div class="min-w-0 overflow-hidden rounded-lg border border-default">
      <UTable :data="status === 'success' ? data?.items || [] : []" :columns="columns" :loading="status === 'pending'">
        <template #title-cell="{ row }">
          <UButton
            color="neutral"
            variant="link"
            class="max-w-80 whitespace-normal text-left"
            @click="selected = row.original"
          >
            {{ row.original.title }}
          </UButton>
          <div v-if="row.original.scheduled_version_id" class="px-2 text-xs text-muted">
            已安排：
            <NuxtLink :to="`/products/${encodeURIComponent(code)}/versions/${row.original.scheduled_version_id}/plan`" class="text-primary hover:underline">
              {{ row.original.scheduled_version_code || '查看版本' }}
            </NuxtLink>
            · {{ row.original.scheduled_plan_status === 'confirmed' ? '已确认' : '草案或待重新确认' }}
          </div>
        </template>
        <template #decision_status-cell="{ row }">
          {{ states[row.original.decision_status] || row.original.decision_status }}
        </template>
        <template #component_name-cell="{ row }">
          {{ row.original.component_name || '未分类' }}
        </template>
        <template #source_type-cell="{ row }">
          {{ sources[row.original.source_type] || row.original.source_type }}
        </template>
        <template #empty>
          <CommonEmptyState :title="status === 'pending' ? '正在加载需求…' : error ? '暂时无法显示需求' : '没有符合条件的需求'" icon="i-lucide-inbox" />
        </template>
      </UTable>
    </div>
    <div v-if="status === 'success'" class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-muted">共 {{ data?.total || 0 }} 条记录，其中 {{ status === 'success' ? data?.unmerged_total || 0 : 0 }} 条未合并需求</span>
      <UPagination
        v-model:page="page"
        :total="data?.total || 0"
        :items-per-page="pageSize"
        :sibling-count="0"
        show-edges
      />
    </div>
    <UModal
      v-model:open="detailOpen"
      :dismissible="!sourceDeleteBusy"
      :close="!sourceDeleteBusy"
      :title="selected?.title || '需求详情'"
      description="需求问题与产品评审决定"
      :ui="{ title: 'break-words' }"
    >
      <template #body>
        <div v-if="selected" class="space-y-3">
          <UButton
            v-if="detailHistory.length"
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            :disabled="sourceDeleteBusy"
            @click="backToMergeTarget"
          >
            返回上级合并目标
          </UButton>
          <UButton
            v-if="canPlan && selected.decision_status !== 'merged'"
            icon="i-lucide-package-plus"
            :disabled="sourceDeleteBusy"
            @click="schedule(selected)"
          >
            排入版本
          </UButton>
          <UDropdownMenu
            v-if="canPlan && selected.decision_status !== 'merged'"
            :items="[{ label: '使用高级规划', icon: 'i-lucide-list-tree', onSelect: () => selected && openPlanning(selected) }]"
          >
            <UButton
              label="更多操作"
              color="neutral"
              variant="ghost"
              trailing-icon="i-lucide-chevron-down"
              :disabled="sourceDeleteBusy"
            />
          </UDropdownMenu>
          <UButton
            v-if="writable && permissions?.edit && selected.decision_status !== 'merged'"
            color="neutral"
            variant="outline"
            icon="i-lucide-plus"
            :disabled="sourceDeleteBusy"
            @click="openSource(selected)"
          >
            添加证据
          </UButton>
          <UButton
            v-if="writable && permissions?.decide && ['submitted', 'evaluating', 'accepted', 'deferred'].includes(selected.decision_status)"
            icon="i-lucide-check-check"
            :disabled="sourceDeleteBusy"
            @click="openDecision(selected)"
          >
            评审需求
          </UButton>
          <UButton
            v-if="writable && permissions?.edit && selected.decision_status !== 'merged'"
            icon="i-lucide-pencil"
            :disabled="sourceDeleteBusy"
            @click="openForm(selected)"
          >
            修改需求
          </UButton>
          <UButton
            v-if="writable && permissions?.decide && selected.decision_status !== 'merged'"
            color="neutral"
            variant="outline"
            :disabled="sourceDeleteBusy"
            icon="i-lucide-git-merge"
            @click="openMerge(selected)"
          >
            合并需求
          </UButton>
          <p class="whitespace-pre-wrap break-words text-sm">
            {{ selected.problem_statement || '未填写问题说明' }}
          </p>
          <dl class="space-y-2 text-sm">
            <div v-if="selected.scheduled_version_id">
              <dt class="text-muted">
                已安排版本
              </dt>
              <dd>
                <NuxtLink :to="`/products/${encodeURIComponent(code)}/versions/${selected.scheduled_version_id}/plan`" class="text-primary hover:underline">
                  {{ selected.scheduled_version_code || '查看版本计划' }}
                </NuxtLink>
                · {{ selected.scheduled_plan_status === 'confirmed' ? '已确认' : '草案或待重新确认' }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                产品决定
              </dt><dd>{{ states[selected.decision_status] }}</dd>
            </div>
            <div>
              <dt class="text-muted">
                决定原因
              </dt><dd class="whitespace-pre-wrap break-words">
                {{ selected.decision_reason || '暂无决定说明' }}
              </dd>
            </div>
            <div v-if="selected.decided_by">
              <dt class="text-muted">
                决定人
              </dt><dd>{{ selected.decided_by }}</dd>
            </div>
            <div v-if="selected.decided_at">
              <dt class="text-muted">
                决定时间
              </dt><dd>{{ formatDateTime(selected.decided_at) }}</dd>
            </div>
          </dl>
          <ProductsRequestMergeTrail
            v-if="selected.decision_status === 'merged'"
            :key="`merge-${selected.biz_id}`"
            :product-code="code"
            :request-id="selected.biz_id"
          />
          <ProductsRequestMergedSources
            :key="`sources-${selected.biz_id}`"
            :product-code="code"
            :request-id="selected.biz_id"
            :disabled="sourceDeleteBusy"
            @select="showMergedSource"
          />
          <ProductsRequestSourceList
            :key="selected.biz_id"
            :product-code="code"
            :request-id="selected.biz_id"
            :can-delete="writable && permissions?.delete === true && selected.decision_status !== 'merged'"
            @changed="saved"
            @busy-change="sourceDeleteBusy = $event"
          />
        </div>
      </template>
    </UModal>
    <UModal
      :open="!!scheduling"
      title="排入版本"
      description="选择轻量计划版本后，在同一范围表单中补充本次范围、估算和验收标准。"
      :dismissible="true"
      @update:open="value => { if (!value) scheduling = null }"
    >
      <template #body>
        <div class="space-y-4">
          <p class="break-words font-medium">
            {{ scheduling?.title }}
          </p>
          <ProductsVersionPicker v-model="selectedVersion" :product-code="code" simple-only />
          <div class="flex flex-wrap justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="scheduling = null">
              取消
            </UButton>
            <UButton :disabled="!selectedVersion" @click="continueSchedule">
              继续填写范围
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
