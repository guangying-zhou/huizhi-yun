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
  permissionCount: number
  appRoleCount: number
  assignedUserCount: number
  appCodes: string[]
}

interface RoleCatalogResponse {
  items: RoleCatalogItem[]
  total: number
  categories: Array<{ value: string, label: string, count: number }>
}

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

const ALL_CATEGORIES_VALUE = '__all_categories__'

const { currentTenantCode } = useTenantContext()
const toast = useToast()
const tenantCode = computed(() => String(currentTenantCode.value || '').trim())
const keyword = ref('')
const categoryFilter = ref(ALL_CATEGORIES_VALUE)
const includeDisabled = ref(false)
const roles = ref<RoleCatalogItem[]>([])
const categories = ref<Array<{ value: string, label: string, count: number }>>([])
const pending = ref(false)

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
const totalAssignedUsers = computed(() => roles.value.reduce((sum, role) => sum + role.assignedUserCount, 0))
const highRiskCount = computed(() => roles.value.filter(role => role.category === 'high_risk_privilege').length)

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

async function loadCatalog() {
  if (!tenantCode.value) {
    roles.value = []
    categories.value = []
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
        page: 1,
        pageSize: 500
      }
    })
    roles.value = response.data.items
    categories.value = response.data.categories
  } catch (error) {
    toast.add({ title: errorMessage(error, '岗位职责目录加载失败'), color: 'error' })
    roles.value = []
  } finally {
    pending.value = false
  }
}

watch(tenantCode, () => {
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

      <div class="grid gap-4 md:grid-cols-3">
        <div class="rounded-lg border border-default bg-muted px-4 py-3">
          <p class="text-xs text-muted">
            目录角色
          </p>
          <p class="mt-2 text-lg font-semibold text-highlighted">
            {{ roles.length }}
          </p>
        </div>
        <div class="rounded-lg border border-default bg-muted px-4 py-3">
          <p class="text-xs text-muted">
            授权人数累计
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
      </div>

      <UCard>
        <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem_auto_auto]">
          <UInput
            v-model="keyword"
            icon="i-lucide-search"
            placeholder="搜索角色名称 / code"
            @keyup.enter="loadCatalog"
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
            @click="loadCatalog"
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
              class="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_8rem_8rem_10rem]"
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
            </div>
          </div>
        </UCard>

        <UCard v-if="!pending && groupedRoles.length === 0">
          <div class="py-10 text-center text-sm text-muted">
            没有匹配的岗位职责角色。
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
