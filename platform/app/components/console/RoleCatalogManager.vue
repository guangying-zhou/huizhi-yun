<script setup lang="ts">
usePageTitle('岗位职责目录')

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface RoleCatalogItem {
  id: number
  roleCode: string
  roleName: string
  roleType: string
  description: string | null
  source: string
  sourceRoleCode: string | null
  status: string
  category: string
  categoryLabel: string
  categorySource: 'manual' | 'derived'
  governanceNote: string | null
  splitSuggestion: string | null
  generatedSplitSuggestion: string | null
  catalogUpdatedByUid: string | null
  catalogUpdatedAt: string | null
  permissionCount: number
  appRoleCount: number
  assignedUserCount: number
  appCodes: string[]
}

interface RoleCatalogResponse {
  items: RoleCatalogItem[]
  total: number
  categories: Array<{ value: string, label: string, count: number }>
  metadataAvailable: boolean
}

interface RoleCatalogGovernanceResponse {
  id: number
  category: string
  categoryLabel: string
  categorySource: 'manual' | 'derived'
  governanceNote: string | null
  splitSuggestion: string | null
  generatedSplitSuggestion?: string | null
  catalogUpdatedByUid: string | null
  catalogUpdatedAt: string | null
}

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

const ALL_CATEGORIES_VALUE = '__all_categories__'
const ROLE_CATEGORY_ITEMS = [
  { label: '主岗位', value: 'main_position' },
  { label: '管理职责', value: 'management_duty' },
  { label: '审批职责', value: 'approval_duty' },
  { label: '专业职责', value: 'professional_duty' },
  { label: '高风险特权', value: 'high_risk_privilege' },
  { label: '自定义角色', value: 'custom_role' }
]

const { currentTenantCode } = useTenantContext()
const toast = useToast()
const tenantCode = computed(() => String(currentTenantCode.value || '').trim())
const keyword = ref('')
const categoryFilter = ref(ALL_CATEGORIES_VALUE)
const includeDisabled = ref(false)
const page = ref(1)
const pageSize = 100
const totalRoles = ref(0)
const roles = ref<RoleCatalogItem[]>([])
const categories = ref<Array<{ value: string, label: string, count: number }>>([])
const pending = ref(false)
const metadataAvailable = ref(true)
const savingRoleId = ref<number | null>(null)
const categoryDrafts = reactive<Record<number, string>>({})
const governanceNoteDrafts = reactive<Record<number, string>>({})
const splitSuggestionDrafts = reactive<Record<number, string>>({})

const categoryItems = computed(() => [
  { label: '全部类别', value: ALL_CATEGORIES_VALUE },
  ...categories.value.map(item => ({
    label: `${item.label} (${item.count})`,
    value: item.value
  }))
])
const selectedCategory = computed(() =>
  categoryFilter.value && categoryFilter.value !== ALL_CATEGORIES_VALUE
    ? categoryFilter.value
    : ''
)
const groupedRoles = computed(() => {
  const groups = new Map<string, { category: string, label: string, roles: RoleCatalogItem[] }>()
  for (const role of roles.value) {
    const group = groups.get(role.category) || {
      category: role.category,
      label: role.categoryLabel,
      roles: []
    }
    group.roles.push(role)
    groups.set(role.category, group)
  }
  return Array.from(groups.values())
})
const totalPages = computed(() => Math.max(1, Math.ceil(totalRoles.value / pageSize)))
const visibleStart = computed(() => totalRoles.value === 0 ? 0 : (page.value - 1) * pageSize + 1)
const visibleEnd = computed(() => Math.min(totalRoles.value, (page.value - 1) * pageSize + roles.value.length))
const totalAssignedUsers = computed(() => roles.value.reduce((sum, role) => sum + role.assignedUserCount, 0))
const highRiskCount = computed(() => categories.value.find(item => item.value === 'high_risk_privilege')?.count || 0)
const governedCount = computed(() => roles.value.filter(role => role.categorySource === 'manual').length)

function errorMessage(error: unknown, fallback: string) {
  const fetchError = error as { data?: { message?: string, statusMessage?: string }, message?: string }
  return fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || fallback
}

function categoryColor(category: string): BadgeColor {
  if (category === 'high_risk_privilege') return 'error'
  if (category === 'approval_duty') return 'warning'
  if (category === 'management_duty') return 'info'
  if (category === 'main_position') return 'success'
  return 'neutral'
}

function appText(role: RoleCatalogItem) {
  if (role.appCodes.length === 0) return '无应用角色映射'
  if (role.appCodes.length <= 4) return role.appCodes.join(' / ')
  return `${role.appCodes.slice(0, 4).join(' / ')} +${role.appCodes.length - 4}`
}

function syncDrafts(nextRoles: RoleCatalogItem[]) {
  for (const role of nextRoles) {
    categoryDrafts[role.id] = role.category
    governanceNoteDrafts[role.id] = role.governanceNote || ''
    splitSuggestionDrafts[role.id] = role.splitSuggestion || ''
  }
}

function roleGovernanceDirty(role: RoleCatalogItem) {
  return (categoryDrafts[role.id] || role.category) !== role.category
    || (governanceNoteDrafts[role.id] || '') !== (role.governanceNote || '')
    || (splitSuggestionDrafts[role.id] || '') !== (role.splitSuggestion || '')
}

function useGeneratedSplitSuggestion(role: RoleCatalogItem) {
  if (!role.generatedSplitSuggestion) return
  splitSuggestionDrafts[role.id] = role.generatedSplitSuggestion
}

async function loadCatalog() {
  if (!tenantCode.value) {
    roles.value = []
    categories.value = []
    totalRoles.value = 0
    page.value = 1
    metadataAvailable.value = true
    return
  }

  pending.value = true
  try {
    const response = await platformFetchJson<ApiEnvelope<RoleCatalogResponse>>('/api/platform/tenant-admin/role-catalog', {
      query: {
        tenantCode: tenantCode.value,
        keyword: keyword.value.trim() || undefined,
        category: selectedCategory.value || undefined,
        includeDisabled: includeDisabled.value ? 'true' : undefined,
        page: page.value,
        pageSize
      }
    })
    roles.value = response.data.items
    totalRoles.value = response.data.total
    categories.value = response.data.categories
    metadataAvailable.value = response.data.metadataAvailable
    syncDrafts(response.data.items)
  } catch (error) {
    toast.add({ title: errorMessage(error, '岗位职责目录加载失败'), color: 'error' })
    roles.value = []
    totalRoles.value = 0
  } finally {
    pending.value = false
  }
}

async function applyCatalogFilters() {
  page.value = 1
  await loadCatalog()
}

async function pageCatalog(delta: number) {
  const nextPage = Math.min(totalPages.value, Math.max(1, page.value + delta))
  if (nextPage === page.value) return
  page.value = nextPage
  await loadCatalog()
}

async function saveRoleGovernance(role: RoleCatalogItem) {
  if (!tenantCode.value || !metadataAvailable.value) return

  savingRoleId.value = role.id
  try {
    const response = await platformFetchJson<ApiEnvelope<RoleCatalogGovernanceResponse>>(`/api/platform/tenant-admin/role-catalog/${role.id}`, {
      method: 'PATCH',
      body: {
        tenantCode: tenantCode.value,
        category: categoryDrafts[role.id] || role.category,
        governanceNote: governanceNoteDrafts[role.id] || null,
        splitSuggestion: splitSuggestionDrafts[role.id] || null
      }
    })
    const updated = response.data
    const index = roles.value.findIndex(item => item.id === role.id)
    if (index >= 0) {
      const currentRole = roles.value[index]
      if (!currentRole) return
      const nextRole: RoleCatalogItem = {
        ...currentRole,
        category: updated.category,
        categoryLabel: updated.categoryLabel,
        categorySource: updated.categorySource,
        governanceNote: updated.governanceNote,
        splitSuggestion: updated.splitSuggestion,
        generatedSplitSuggestion: updated.generatedSplitSuggestion ?? currentRole.generatedSplitSuggestion,
        catalogUpdatedByUid: updated.catalogUpdatedByUid,
        catalogUpdatedAt: updated.catalogUpdatedAt
      }
      roles.value.splice(index, 1, nextRole)
      syncDrafts([nextRole])
    }
    toast.add({ title: '岗位职责目录已保存', color: 'success' })
  } catch (error) {
    toast.add({ title: errorMessage(error, '岗位职责目录保存失败'), color: 'error' })
  } finally {
    savingRoleId.value = null
  }
}

watch(tenantCode, () => {
  page.value = 1
  loadCatalog()
}, { immediate: true })
</script>

<template>
  <UDashboardPanel
    id="tenant-role-catalog"
    class="h-[calc(100dvh-var(--topbar-h,52px)-0.5rem)] min-h-0"
    :ui="{ body: 'console-page flex flex-col min-h-0 overflow-hidden' }"
  >
    <template #body>
      <UAlert
        v-if="!tenantCode"
        color="warning"
        variant="soft"
        icon="i-lucide-building-2"
        title="请先在企业工作台选择企业"
        description="未选择企业时无法加载岗位职责目录。"
      />

      <section class="console-hero">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 class="text-xl font-semibold text-highlighted">
              岗位职责目录
            </h1>
            <p class="mt-1 text-sm text-muted">
              将企业角色按主岗位、管理职责、审批职责和高风险特权分组，辅助清理过宽角色。
            </p>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="pending"
            @click="loadCatalog"
          >
            刷新
          </UButton>
        </div>
      </section>

      <UAlert
        v-if="!metadataAvailable"
        color="warning"
        variant="soft"
        icon="i-lucide-database"
        title="目录治理表未启用"
        description="当前仅显示规则推断分类；应用 v2.22 迁移后可保存目录分类、治理备注和拆分建议。"
      />

      <div class="grid gap-4 md:grid-cols-4">
        <div class="rounded-lg border border-default bg-muted px-4 py-3">
          <p class="text-xs text-muted">
            目录角色
          </p>
          <p class="mt-2 text-lg font-semibold text-highlighted">
            {{ totalRoles }}
          </p>
        </div>
        <div class="rounded-lg border border-default bg-muted px-4 py-3">
          <p class="text-xs text-muted">
            当前页授权人数累计
          </p>
          <p class="mt-2 text-lg font-semibold text-highlighted">
            {{ totalAssignedUsers }}
          </p>
        </div>
        <div class="rounded-lg border border-default bg-muted px-4 py-3">
          <p class="text-xs text-muted">
            高风险特权
          </p>
          <p class="mt-2 text-lg font-semibold text-highlighted">
            {{ highRiskCount }}
          </p>
        </div>
        <div class="rounded-lg border border-default bg-muted px-4 py-3">
          <p class="text-xs text-muted">
            当前页已治理分类
          </p>
          <p class="mt-2 text-lg font-semibold text-highlighted">
            {{ governedCount }}
          </p>
        </div>
      </div>

      <UCard>
        <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem_auto_auto]">
          <UInput
            v-model="keyword"
            icon="i-lucide-search"
            placeholder="搜索角色名称 / code"
            @keyup.enter="applyCatalogFilters"
          />
          <USelect
            v-model="categoryFilter"
            :items="categoryItems"
          />
          <UCheckbox
            v-model="includeDisabled"
            label="显示停用"
          />
          <UButton
            icon="i-lucide-filter"
            :loading="pending"
            @click="applyCatalogFilters"
          >
            筛选
          </UButton>
        </div>
      </UCard>

      <div class="flex-1 min-h-0 overflow-y-auto space-y-4">
        <UCard
          v-for="group in groupedRoles"
          :key="group.category"
          :ui="{ body: 'p-0 sm:p-0' }"
        >
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold text-highlighted">
                  {{ group.label }}
                </h2>
                <p class="mt-1 text-sm text-muted">
                  {{ group.roles.length }} 个角色
                </p>
              </div>
              <UBadge
                :color="categoryColor(group.category)"
                variant="soft"
              >
                {{ group.category }}
              </UBadge>
            </div>
          </template>

          <div class="divide-y divide-default">
            <div
              v-for="role in group.roles"
              :key="role.roleCode"
              class="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_7rem_7rem_8rem_minmax(16rem,22rem)]"
            >
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="font-semibold text-highlighted">
                    {{ role.roleName }}
                  </p>
                  <UBadge
                    :color="role.status === 'active' ? 'success' : 'neutral'"
                    variant="soft"
                  >
                    {{ role.status }}
                  </UBadge>
                </div>
                <p class="mt-1 font-mono text-xs text-muted">
                  {{ role.roleCode }}
                </p>
                <p
                  v-if="role.description"
                  class="mt-2 line-clamp-2 text-sm text-muted"
                >
                  {{ role.description }}
                </p>
                <p class="mt-2 truncate text-xs text-muted">
                  {{ appText(role) }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  权限
                </p>
                <p class="mt-1 font-semibold text-highlighted">
                  {{ role.permissionCount }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  应用角色
                </p>
                <p class="mt-1 font-semibold text-highlighted">
                  {{ role.appRoleCount }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  已授权用户
                </p>
                <p class="mt-1 font-semibold text-highlighted">
                  {{ role.assignedUserCount }}
                </p>
              </div>
              <div class="min-w-0 space-y-2">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-xs text-muted">
                    目录治理
                  </p>
                  <UBadge
                    :color="role.categorySource === 'manual' ? 'primary' : 'neutral'"
                    variant="soft"
                  >
                    {{ role.categorySource === 'manual' ? '已治理' : '规则推断' }}
                  </UBadge>
                </div>
                <div class="flex items-center gap-2">
                  <USelect
                    v-model="categoryDrafts[role.id]"
                    class="min-w-0 flex-1"
                    :items="ROLE_CATEGORY_ITEMS"
                    :disabled="!metadataAvailable || savingRoleId === role.id"
                  />
                  <UButton
                    color="primary"
                    variant="soft"
                    size="sm"
                    icon="i-lucide-save"
                    aria-label="保存目录治理"
                    :loading="savingRoleId === role.id"
                    :disabled="!metadataAvailable || !roleGovernanceDirty(role)"
                    @click="saveRoleGovernance(role)"
                  />
                </div>
                <UInput
                  v-model="governanceNoteDrafts[role.id]"
                  size="sm"
                  placeholder="治理备注"
                  :disabled="!metadataAvailable || savingRoleId === role.id"
                />
                <UInput
                  v-model="splitSuggestionDrafts[role.id]"
                  size="sm"
                  placeholder="拆分建议"
                  :disabled="!metadataAvailable || savingRoleId === role.id"
                />
                <div
                  v-if="role.generatedSplitSuggestion"
                  class="rounded-lg border border-default bg-muted px-3 py-2"
                >
                  <p class="text-xs text-muted">
                    {{ role.generatedSplitSuggestion }}
                  </p>
                  <UButton
                    class="mt-2"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-wand-sparkles"
                    :disabled="!metadataAvailable || savingRoleId === role.id || splitSuggestionDrafts[role.id] === role.generatedSplitSuggestion"
                    @click="useGeneratedSplitSuggestion(role)"
                  >
                    采用建议
                  </UButton>
                </div>
              </div>
            </div>
          </div>
        </UCard>

        <UCard v-if="!pending && groupedRoles.length === 0">
          <div class="py-10 text-center text-sm text-muted">
            没有匹配的岗位职责角色。
          </div>
        </UCard>

        <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default bg-default px-4 py-3 text-sm text-muted">
          <p>
            共 {{ totalRoles }} 个角色 · 显示 {{ visibleStart }}-{{ visibleEnd }} · 第 {{ page }} / {{ totalPages }} 页
          </p>
          <div class="flex items-center gap-2">
            <UButton
              color="neutral"
              variant="soft"
              size="sm"
              icon="i-lucide-chevron-left"
              :disabled="page <= 1 || pending"
              @click="pageCatalog(-1)"
            >
              上一页
            </UButton>
            <UButton
              color="neutral"
              variant="soft"
              size="sm"
              trailing-icon="i-lucide-chevron-right"
              :disabled="page >= totalPages || pending"
              @click="pageCatalog(1)"
            >
              下一页
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
