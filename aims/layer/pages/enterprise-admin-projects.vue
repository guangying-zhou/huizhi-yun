<script setup lang="ts">
import ContentPageHeader from '@hzy/foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '@hzy/foundation/app/components/common/EmptyState.vue'
import ProjectPortfolioSelect from '../../app/components/project/ProjectPortfolioSelect.vue'
import type { AdminProject } from '../../app/types/adminProject'
import { projectCategoryConfig, projectCategoryOptions, projectConfidentialityLevelConfig, projectSecurityLevelConfig, projectStatusConfig, projectStatusOptions } from '../../app/config/project'
import { useAimsModule } from '../useAimsModule'

definePageMeta({
  hostContentInset: false })
const {
  moduleUrl } = useAimsModule()
const toast = useToast(), {
  confirm } = useConfirm()
const {
  loaded, error: permissionError, loadPermissions, hasPermission } = usePermissions()
const canView = computed(() => loaded.value && hasPermission('admin', 'admin'))
const canCreate = computed(() => loaded.value && hasPermission('projects', 'create'))
const canCreatePortfolio = computed(() => loaded.value && hasPermission('portfolios', 'admin'))
const page = ref(1), pageSize = ref(20), category = ref('all'), lifecycleStatus = ref('all'), portfolioId = ref(''), sort = ref('code'), filtersOpen = ref(false)
const {
  search, debounced, flush } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  } })
interface ProjectRoot { id: number, code: string, name: string, projectCount: number }
const roots = ref<ProjectRoot[]>([])
const expanded = ref<Set<number>>(new Set())
const children = ref<Record<number, { items: AdminProject[], total: number, page: number, loading: boolean, error: string }>>({})
const total = ref(0), loading = ref(false), error = ref(''), forbidden = ref(false)
let generation = 0
const filterCount = computed(() => Number(category.value !== 'all') + Number(lifecycleStatus.value !== 'all') + Number(Boolean(portfolioId.value)))
const categoryOptions = [{
  label: '全部类型', value: 'all' }, ...projectCategoryOptions]
const statusOptions = [{
  label: '全部状态', value: 'all' }, ...projectStatusOptions]
const sortOptions = [{
  label: '项目编码', value: 'code' }, {
  label: '项目名称', value: 'name' }, {
  label: '最近更新', value: 'updated' }, {
  label: '开始日期', value: 'start' }]
const optionalColumns = [{
  key: 'shortName', label: '简称' }, {
  key: 'leaderUid', label: '负责人' }, {
  key: 'deptCode', label: '部门' }, {
  key: 'startDate', label: '开始日期' }, {
  key: 'endDate', label: '结束日期' }, {
  key: 'securityLevel', label: '可见范围' }, {
  key: 'confidentialityLevel', label: '密级' }, {
  key: 'counts', label: '关联项' }]
const defaults = ['leaderUid', 'startDate', 'securityLevel', 'counts']
const visibleColumns = ref([...defaults])
const cacheScope = useState<string>('enterprise-cache-scope', () => '')
const columns = computed(() => [
  {
    accessorKey: 'projectCode', header: '编码' }, {
    accessorKey: 'name', header: '项目' }, {
    accessorKey: 'category', header: '类型' }, {
    accessorKey: 'lifecycleStatus', header: '状态' },
  ...optionalColumns.filter(column => visibleColumns.value.includes(column.key)).map(column => ({
    accessorKey: column.key, header: column.label })), {
    id: 'actions', header: '操作' }
])
watch(cacheScope, (scope) => {
  visibleColumns.value = [...defaults]
  if (!scope || typeof localStorage === 'undefined') return
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(`hzy.aims.admin-projects:${scope}`) || 'null')
    if (Array.isArray(saved)) visibleColumns.value = optionalColumns.map(column => column.key).filter(key => saved.includes(key))
  } catch {
    /* stale local preference */ }
}, {
  immediate: true })
function saveView() {
  if (!cacheScope.value) return
  try {
    localStorage.setItem(`hzy.aims.admin-projects:${cacheScope.value}`, JSON.stringify(visibleColumns.value))
    toast.add({
      title: '已保存本机视图', color: 'success' })
  } catch {
    toast.add({
      title: '视图保存失败', color: 'error' })
  }
}
async function loadProjects() {
  const current = ++generation
  roots.value = []
  expanded.value = new Set()
  children.value = {}
  total.value = 0
  error.value = ''
  forbidden.value = false
  if (!canView.value) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const res = await $fetch<{
      code: number
      data: {
        items: ProjectRoot[]
        total: number
        page: number
        pageSize: number } }>(moduleUrl('/api/v1/admin/projects'), {
      query: {
        tree: 'true', page: page.value, pageSize: pageSize.value, ...(debounced.value
          ? {
              search: debounced.value }
          : {}), ...(category.value !== 'all'
          ? {
              category: category.value }
          : {}), ...(lifecycleStatus.value !== 'all'
          ? {
              lifecycleStatus: lifecycleStatus.value }
          : {}), ...(portfolioId.value
          ? {
              portfolioId: portfolioId.value }
          : {}), ...(sort.value !== 'code'
          ? {
              sort: sort.value }
          : {}) }
    })
    if (current !== generation) return
    if (res.code !== 0 || !Array.isArray(res.data?.items) || res.data.page !== page.value || res.data.pageSize !== pageSize.value || !Number.isSafeInteger(res.data.total) || res.data.total < 0) throw Error('项目列表响应无效')
    roots.value = res.data.items
    total.value = res.data.total
  } catch (cause) {
    if (current !== generation) return
    forbidden.value = (cause as {
      statusCode?: number }).statusCode === 403
    error.value = forbidden.value ? '你没有管理员项目查看权限' : '项目列表暂不可用，请稍后重试'
  } finally {
    if (current === generation) loading.value = false
  }
}
async function loadChildren(root: ProjectRoot, childPage = 1) {
  const current = generation
  const initial = { items: [] as AdminProject[], total: 0, page: childPage, loading: true, error: '' }
  children.value[root.id] = initial
  const state = children.value[root.id]!
  try {
    const response = await $fetch<{ code: number, data: { items: AdminProject[], total: number } }>(moduleUrl('/api/v1/admin/projects'), { query: {
      page: childPage, pageSize: 20, portfolioId: String(root.id),
      ...(debounced.value ? { search: debounced.value } : {}),
      ...(category.value !== 'all' ? { category: category.value } : {}),
      ...(lifecycleStatus.value !== 'all' ? { lifecycleStatus: lifecycleStatus.value } : {}),
      ...(sort.value !== 'code' ? { sort: sort.value } : {})
    } })
    if (current !== generation || children.value[root.id] !== state || !expanded.value.has(root.id)) return
    if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total)) throw Error('项目响应无效')
    state.items = response.data.items
    state.total = response.data.total
  } catch {
    if (current === generation && children.value[root.id] === state) state.error = '项目暂不可用，请重试'
  } finally {
    if (current === generation && children.value[root.id] === state) state.loading = false
  }
}
function toggleRoot(root: ProjectRoot) {
  const next = new Set(expanded.value)
  if (next.has(root.id)) {
    next.delete(root.id)
    children.value = Object.fromEntries(Object.entries(children.value).filter(([key]) => key !== String(root.id)))
  } else {
    next.add(root.id)
    expanded.value = next
    void loadChildren(root)
  }
  expanded.value = next
}
function clearFilters() {
  search.value = ''
  category.value = 'all'
  lifecycleStatus.value = 'all'
  portfolioId.value = ''
  flush()
}
watch([category, lifecycleStatus, portfolioId, sort, pageSize], () => {
  page.value = 1
}, {
  flush: 'sync' })
watch([page, debounced, category, lifecycleStatus, portfolioId, sort, pageSize, canView], () => void loadProjects(), {
  immediate: true })
watch(cacheScope, () => void loadProjects())
onMounted(() => void loadPermissions())
const batchOpen = ref(false), batchYear = ref(new Date().getFullYear()), batchSaving = ref(false), batchError = ref('')
const pendingBatch = ref<{
  key: string
  year: number } | null>(null)
async function createBatch() {
  if (batchSaving.value || !canView.value || !Number.isInteger(batchYear.value) || batchYear.value < 2000 || batchYear.value > 2100) return
  if (!pendingBatch.value) {
    batchOpen.value = false
    if (!(await confirm({
      title: '批量创建部门事务项目', message: `按正式目录为 ${batchYear.value} 年各部门创建日常事务项目；已有项目和未配置有效负责人的部门跳过，不覆盖已有项目。`, confirmLabel: '创建', tone: 'warning' }))) {
      batchOpen.value = true
      return
    }
    pendingBatch.value = {
      key: crypto.randomUUID(), year: batchYear.value }
  }
  batchOpen.value = true
  batchSaving.value = true
  batchError.value = ''
  try {
    const intent = pendingBatch.value
    const res = await $fetch<{
      code: number
      data: {
        idempotent?: boolean
        result: {
          summary: {
            created: number
            existing: number
            missingManager: number } } } }>(moduleUrl('/api/v1/admin/projects/batch-create-routine'), {
      method: 'POST', headers: {
        'Idempotency-Key': intent.key }, body: {
        year: intent.year } })
    if (res.code !== 0 || (!res.data?.idempotent && !res.data?.result?.summary)) throw Error('批量创建响应无效')
    const summary = res.data.result?.summary
    toast.add({
      title: `${intent.year} 年部门事务项目处理完成`, description: summary ? `创建 ${summary.created} 个，已有 ${summary.existing} 个跳过，缺少有效负责人 ${summary.missingManager} 个跳过。` : '原请求已完成，已刷新项目列表', color: summary?.missingManager ? 'warning' : 'success' })
    pendingBatch.value = null
    batchOpen.value = false
    await loadProjects()
  } catch (cause) {
    const status = (cause as {
      statusCode?: number }).statusCode || 0
    batchError.value = !status || status >= 500
      ? '保存结果未确认，可能已提交，重试将沿用同一请求安全续行。'
      : (cause as {
          data?: {
            message?: string } }).data?.message || '批量创建失败，请检查权限和输入'
    if (status && status < 500) pendingBatch.value = null
    toast.add({
      title: '批量创建未完成', description: batchError.value, color: 'error' })
  } finally {
    batchSaving.value = false
  }
}
</script>

<template>
  <div class="space-y-4 p-4 sm:p-6">
    <ContentPageHeader hosted title="项目管理">
      <template #actions>
        <UButton
          v-if="canView"
          color="neutral"
          variant="outline"
          icon="i-lucide-layers-plus"
          @click="batchOpen = true"
        >
          批量部门事务
        </UButton>
        <UButton
          v-if="canCreatePortfolio"
          :to="moduleUrl('/portfolios/new')"
          color="neutral"
          variant="outline"
          icon="i-lucide-folder-plus"
        >
          新建项目集
        </UButton>
        <UButton v-if="canCreate" :to="moduleUrl('/projects/new') + '?returnTo=admin'" icon="i-lucide-plus">
          登记项目
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          aria-label="刷新项目"
          @click="loadProjects"
        />
      </template>
    </ContentPageHeader>
    <CommonEmptyState v-if="permissionError" title="权限加载失败" description="权限信息暂不可用，请重试">
      <template #actions>
        <UButton @click="loadPermissions({ force: true })">
          重试
        </UButton>
      </template>
    </CommonEmptyState>
    <CommonEmptyState v-else-if="!loaded" title="正在加载权限" />
    <CommonEmptyState v-else-if="!canView || forbidden" title="无权限" description="需要 Aims 系统管理权限才能查看管理员项目列表" />
    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="搜索名称、编码或负责人"
          class="min-w-0 flex-1 sm:min-w-56"
          @keydown.enter="flush"
        />
        <USelect
          v-model="lifecycleStatus"
          :items="statusOptions"
          aria-label="项目状态"
          class="hidden w-36 sm:block"
        />
        <UPopover v-model:open="filtersOpen">
          <UButton color="neutral" variant="outline" icon="i-lucide-filter">
            筛选{{ filterCount ? ` (${filterCount})` : '' }}
          </UButton><template #content>
            <div class="grid w-[min(20rem,calc(100vw-2rem))] gap-3 p-4">
              <UFormField label="项目状态">
                <USelect v-model="lifecycleStatus" :items="statusOptions" class="w-full" />
              </UFormField><UFormField label="项目类型">
                <USelect v-model="category" :items="categoryOptions" class="w-full" />
              </UFormField><UFormField label="项目集">
                <ProjectPortfolioSelect v-model="portfolioId" all />
              </UFormField>
              <UFormField label="排序" class="sm:hidden">
                <USelect v-model="sort" :items="sortOptions" class="w-full" />
              </UFormField>
              <UButton
                v-if="filterCount || search"
                color="neutral"
                variant="ghost"
                @click="clearFilters"
              >
                清除筛选
              </UButton>
            </div>
          </template>
        </UPopover>
        <div class="ml-auto hidden items-center gap-2 sm:flex">
          <USelect
            v-model="sort"
            :items="sortOptions"
            aria-label="项目排序"
            class="w-36"
          />
          <UPopover>
            <UButton color="neutral" variant="outline" icon="i-lucide-columns-3">
              显示列
            </UButton><template #content>
              <div class="w-56 space-y-2 p-3">
                <UCheckbox
                  v-for="column in optionalColumns"
                  :key="column.key"
                  :label="column.label"
                  :model-value="visibleColumns.includes(column.key)"
                  @update:model-value="value => visibleColumns = value ? [...visibleColumns, column.key] : visibleColumns.filter(key => key !== column.key)"
                /><div class="border-t border-default pt-2">
                  <UButton
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-save"
                    @click="saveView"
                  >
                    保存视图
                  </UButton>
                </div>
              </div>
            </template>
          </UPopover>
          <UButton
            v-if="filterCount || search"
            color="neutral"
            variant="ghost"
            @click="clearFilters"
          >
            清除筛选
          </UButton>
        </div>
      </div>
      <CommonEmptyState v-if="error" title="加载失败" :description="error">
        <template #actions>
          <UButton @click="loadProjects">
            重试
          </UButton>
        </template>
      </CommonEmptyState>
      <template v-else>
        <CommonEmptyState v-if="loading" title="正在加载项目集" />
        <CommonEmptyState v-else-if="!roots.length" title="暂无项目集或项目" description="调整筛选条件，或登记项目" />
        <section v-for="root in roots" :key="root.id" class="min-w-0 overflow-hidden rounded-lg border border-default">
          <div class="flex min-w-0 flex-wrap items-center gap-2 bg-elevated px-3 py-2">
            <UButton
              :icon="expanded.has(root.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              color="neutral"
              variant="ghost"
              :aria-label="`${expanded.has(root.id) ? '收起' : '展开'}${root.name}`"
              :aria-expanded="expanded.has(root.id)"
              @click="toggleRoot(root)"
            />
            <UIcon name="i-lucide-folder" class="size-4 shrink-0 text-primary" />
            <span class="min-w-0 flex-1 truncate font-semibold" :title="root.name">{{ root.name }} ({{ root.projectCount }})</span>
            <span class="hidden text-xs text-muted sm:block">{{ root.code }}</span>
            <div class="flex shrink-0 gap-1">
              <UButton
                v-if="root.id && canCreatePortfolio"
                :to="{ path: moduleUrl('/portfolios/new'), query: { editId: String(root.id) } }"
                size="xs"
                color="neutral"
                variant="ghost"
              >
                编辑
              </UButton>
              <UButton
                v-if="canCreate"
                :to="moduleUrl(`/projects/new?returnTo=admin${root.id ? `&portfolioId=${root.id}` : ''}`)"
                size="xs"
                variant="soft"
              >
                新建项目
              </UButton>
            </div>
          </div>
          <template v-if="expanded.has(root.id) && children[root.id]">
            <CommonEmptyState v-if="children[root.id]!.error" title="加载失败" :description="children[root.id]!.error">
              <template #actions>
                <UButton @click="loadChildren(root, children[root.id]!.page)">
                  重试
                </UButton>
              </template>
            </CommonEmptyState>
            <template v-else>
              <UTable
                :data="children[root.id]!.items"
                :columns="columns"
                :loading="children[root.id]!.loading"
                class="hidden w-full md:block"
              >
                <template #projectCode-cell="{ row }">
                  <span class="block max-w-36 truncate font-mono text-xs" :title="row.original.projectCode">{{ row.original.projectCode }}</span>
                </template>
                <template #name-cell="{ row }">
                  <NuxtLink :to="moduleUrl(`/projects/${row.original.id}`)" class="block max-w-64 truncate font-medium" :title="row.original.name">{{ row.original.name }}</NuxtLink>
                </template>
                <template #category-cell="{ row }">
                  {{ projectCategoryConfig[row.original.category]?.label || row.original.category }}
                </template>
                <template #lifecycleStatus-cell="{ row }">
                  <UBadge :color="projectStatusConfig[row.original.lifecycleStatus]?.color || 'neutral'" variant="subtle">
                    {{ projectStatusConfig[row.original.lifecycleStatus]?.label || row.original.lifecycleStatus }}
                  </UBadge>
                </template>
                <template #securityLevel-cell="{ row }">
                  {{ projectSecurityLevelConfig[row.original.securityLevel]?.label }}
                </template>
                <template #confidentialityLevel-cell="{ row }">
                  {{ projectConfidentialityLevelConfig[row.original.confidentialityLevel]?.label }}
                </template>
                <template #leaderUid-cell="{ row }">
                  <span class="block max-w-32 truncate" :title="row.original.leaderUid || ''">{{ row.original.leaderUid || '未分配' }}</span>
                </template>
                <template #counts-cell="{ row }">
                  <span class="whitespace-nowrap text-xs text-muted">成员 {{ row.original.counts?.members ?? '—' }} · 里程碑 {{ row.original.counts?.milestones ?? '—' }} · 工作项 {{ row.original.counts?.workItems ?? '—' }}</span>
                </template>
                <template #actions-cell="{ row }">
                  <UDropdownMenu :items="[{ label: '编辑基本信息', icon: 'i-lucide-pencil', to: moduleUrl(`/admin/projects/${row.original.id}/edit`) }, { label: '成员管理', icon: 'i-lucide-users', to: moduleUrl(`/projects/${row.original.id}/members`) }, { label: '状态与设置', icon: 'i-lucide-settings', to: moduleUrl(`/projects/${row.original.id}/settings`) }]">
                    <UButton
                      icon="i-lucide-ellipsis"
                      color="neutral"
                      variant="ghost"
                      aria-label="项目操作"
                    />
                  </UDropdownMenu>
                </template>
                <template #empty>
                  <CommonEmptyState title="暂无项目" description="调整筛选条件，或登记项目" />
                </template>
              </UTable>
              <div class="grid gap-3 md:hidden">
                <CommonEmptyState v-if="children[root.id]!.loading" title="正在加载项目" /><CommonEmptyState v-else-if="!children[root.id]!.items.length" title="暂无项目" description="调整筛选条件，或登记项目" /><UCard v-for="project in children[root.id]!.items" :key="project.id">
                  <div class="flex min-w-0 items-start gap-2">
                    <NuxtLink :to="moduleUrl(`/projects/${project.id}`)" class="min-w-0 flex-1 truncate font-medium" :title="project.name">{{ project.name }}</NuxtLink><UBadge :color="projectStatusConfig[project.lifecycleStatus]?.color || 'neutral'">
                      {{ projectStatusConfig[project.lifecycleStatus]?.label }}
                    </UBadge>
                  </div><div class="mt-2 grid grid-cols-2 gap-2 text-xs text-muted">
                    <span class="truncate">{{ project.projectCode }}</span><span class="truncate">{{ project.leaderUid || '未分配' }}</span><span>{{ projectCategoryConfig[project.category]?.label }}</span><span>{{ project.startDate || '未设置日期' }}</span>
                  </div><div class="mt-3 flex flex-wrap gap-2">
                    <UButton
                      :to="moduleUrl(`/admin/projects/${project.id}/edit`)"
                      color="neutral"
                      variant="outline"
                      size="sm"
                    >
                      编辑
                    </UButton><UButton
                      :to="moduleUrl(`/projects/${project.id}/members`)"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                    >
                      成员
                    </UButton><UButton
                      :to="moduleUrl(`/projects/${project.id}/settings`)"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                    >
                      状态与设置
                    </UButton>
                  </div>
                </UCard>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span class="text-xs text-muted">共 {{ children[root.id]!.total }} 个项目</span>
                <UPagination
                  :page="children[root.id]!.page"
                  :total="children[root.id]!.total"
                  :items-per-page="20"
                  :sibling-count="0"
                  @update:page="value => loadChildren(root, value)"
                />
              </div>
            </template>
          </template>
        </section>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span class="text-sm text-muted">共 {{ total }} 个项目集 / 分组</span><div class="flex items-center gap-2">
            <USelect
              v-model="pageSize"
              :items="[20, 50, 100]"
              aria-label="每页条数"
              class="hidden w-20 sm:block"
            /><UPagination
              v-model:page="page"
              :total="total"
              :items-per-page="pageSize"
              :sibling-count="0"
            />
          </div>
        </div>
      </template>
    </template>
    <UModal v-model:open="batchOpen" title="批量创建部门事务项目" :dismissible="!batchSaving">
      <template #body>
        <UAlert
          v-if="batchError"
          color="error"
          title="批量创建未完成"
          :description="batchError"
        /><UFormField label="年度" required>
          <UInput
            v-model.number="batchYear"
            type="number"
            min="2000"
            max="2100"
            :disabled="batchSaving || !!pendingBatch"
            class="w-full"
          />
        </UFormField>
      </template><template #footer>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="batchSaving"
          @click="batchOpen = false"
        >
          取消
        </UButton><UButton :loading="batchSaving" :disabled="batchYear < 2000 || batchYear > 2100" @click="createBatch">
          {{ pendingBatch ? '原键重试' : '继续' }}
        </UButton>
      </template>
    </UModal>
  </div>
</template>
