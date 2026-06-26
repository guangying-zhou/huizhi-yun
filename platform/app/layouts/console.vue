<script setup lang="ts">
useHeartbeat()

const route = useRoute()
const router = useRouter()
const { getVisibleSection } = useConsoleMenus()
const { currentTenantCode, setCurrentTenantCode, clearCurrentTenantCode } = useTenantContext()
const { hasPermission, hasRole, loadAuthorization, clearAuthorizationCache } = usePlatformPermission()
const { refreshHandler } = usePageActions()
const auth = useAuth()
const toast = useToast()

type ConsoleScope = 'admin' | 'dashboard'
type PermissionAction = 'view' | 'edit' | 'admin'
type TenantType = 'enterprise' | 'team' | 'trial'
type AuthMode = 'oidc' | 'gitlab_oidc' | 'cas' | 'wecom'
type DeploymentMode = 'managed-control-plane' | 'self-hosted-enterprise'

interface TenantItem {
  id: number
  tenantCode: string
  tenantName: string
  displayName: string | null
  tenantType: TenantType
  primaryDomain: string | null
  industryCategory: string | null
  companySize: string | null
  province: string | null
  city: string | null
  status: string
  defaultAuthMode: AuthMode
  defaultDeploymentMode: DeploymentMode
  onboardingStage: string
  membershipStatus: string
  isOwner: boolean
  roleCodes: string[]
  joinedAt: string | null
  lastAccessedAt: string | null
  createdAt: string
  updatedAt: string
}

interface FetchLikeError {
  data?: {
    message?: string
    statusMessage?: string
  }
  message?: string
}

type ApiEnvelope<T> = {
  success: true
  data: T
}

const scope = computed<ConsoleScope>(() => route.path.startsWith('/dashboard') ? 'dashboard' : 'admin')
const activeTenantCode = computed(() => String(toValue(currentTenantCode) || '').trim())
const tenantItems = ref<TenantItem[]>([])
const tenantsPending = ref(false)
const tenantsError = ref<string | null>(null)
const createTenantOpen = ref(false)
const createTenantPending = ref(false)
const createTenantError = ref<string | null>(null)
const createTenantForm = reactive({
  tenantName: '',
  displayName: '',
  industryCategory: '',
  companySize: '',
  province: '',
  city: '',
  defaultDeploymentMode: 'managed-control-plane' as DeploymentMode
})

const industryCategoryItems = [
  { value: 'A', label: 'A 农、林、牧、渔业' },
  { value: 'B', label: 'B 采矿业' },
  { value: 'C', label: 'C 制造业' },
  { value: 'D', label: 'D 电力、热力、燃气及水生产和供应业' },
  { value: 'E', label: 'E 建筑业' },
  { value: 'F', label: 'F 批发和零售业' },
  { value: 'G', label: 'G 交通运输、仓储和邮政业' },
  { value: 'H', label: 'H 住宿和餐饮业' },
  { value: 'I', label: 'I 信息传输、软件和信息技术服务业' },
  { value: 'J', label: 'J 金融业' },
  { value: 'K', label: 'K 房地产业' },
  { value: 'L', label: 'L 租赁和商务服务业' },
  { value: 'M', label: 'M 科学研究和技术服务业' },
  { value: 'N', label: 'N 水利、环境和公共设施管理业' },
  { value: 'O', label: 'O 居民服务、修理和其他服务业' },
  { value: 'P', label: 'P 教育' },
  { value: 'Q', label: 'Q 卫生和社会工作' },
  { value: 'R', label: 'R 文化、体育和娱乐业' },
  { value: 'S', label: 'S 公共管理、社会保障和社会组织' },
  { value: 'T', label: 'T 国际组织' }
]

const companySizeItems = [
  { value: 'micro', label: '微型（1-20人）' },
  { value: 'small', label: '小型（21-300人）' },
  { value: 'medium', label: '中型（301-1000人）' },
  { value: 'large', label: '大型（1000人以上）' }
]
const consoleTenantsApi = '/api/platform/console/tenants' as string

const activeMenu = computed(() => getVisibleSection(scope.value, {
  hasPermission(permission) {
    const [resource, action = 'view'] = permission.split(':')
    if (!resource) return true
    return hasPermission(resource, action as PermissionAction)
  },
  hasRole,
  currentTenantCode: activeTenantCode.value
}))
const activeMenuGroups = computed(() => {
  if (activeMenu.value.groups?.length) {
    return activeMenu.value.groups
  }

  return [{
    group: activeMenu.value.title,
    items: activeMenu.value.items
  }]
})

const displayUser = computed(() => String(auth.userRealname.value || auth.user.value || '未登录'))
const initials = computed(() => {
  const name = displayUser.value
  return name.length >= 2 ? name.slice(0, 2).toUpperCase() : name.toUpperCase()
})

const activeTenant = computed(() => {
  return tenantItems.value.find(item => item.tenantCode === activeTenantCode.value) || null
})
const tenantSwitcherLabel = computed(() => {
  if (tenantsPending.value && !tenantItems.value.length) return '加载企业'
  if (activeTenant.value) return tenantDisplayName(activeTenant.value)
  if (activeTenantCode.value) return activeTenantCode.value
  return scope.value === 'admin' ? '平台运营' : '选择企业'
})
const tenantMenuItems = computed(() => {
  const items: Array<Array<Record<string, unknown>>> = []

  if (tenantItems.value.length) {
    items.push(tenantItems.value.map(tenant => ({
      label: tenantDisplayName(tenant),
      icon: tenant.tenantCode === activeTenantCode.value ? 'i-lucide-check' : 'i-lucide-building-2',
      onSelect: () => switchTenant(tenant.tenantCode)
    })))
  } else if (tenantsPending.value) {
    items.push([{
      label: '正在加载企业...',
      icon: 'i-lucide-loader-circle',
      disabled: true
    }])
  } else if (tenantsError.value) {
    items.push([{
      label: tenantsError.value,
      icon: 'i-lucide-circle-alert',
      disabled: true
    }])
  }

  items.push([{
    label: '新建企业',
    icon: 'i-lucide-plus',
    onSelect: openCreateTenant
  }])

  return items
})

const userMenuItems = computed(() => [[
  {
    label: displayUser.value,
    icon: 'i-lucide-user'
  },
  {
    label: '退出登录',
    icon: 'i-lucide-log-out',
    onSelect: handleLogout
  }
]])

function isActivePath(path: string): boolean {
  if (path === '/admin' || path === '/dashboard') return route.path === path
  return route.path === path || route.path.startsWith(`${path}/`)
}

function triggerRefresh() {
  return refreshHandler.value?.()
}

function tenantDisplayName(tenant: TenantItem | null | undefined) {
  if (!tenant) return ''
  return tenant.displayName || tenant.tenantName || tenant.tenantCode
}

function extractErrorMessage(error: unknown, fallback: string) {
  const fetchError = error as FetchLikeError
  return fetchError?.data?.message || fetchError?.data?.statusMessage || fetchError?.message || fallback
}

async function fetchApi<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers
    }
  })
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | FetchLikeError | null

  if (!response.ok) {
    const message = extractErrorMessage(payload, response.statusText || '请求失败')
    throw {
      message,
      data: payload
    }
  }

  return payload as ApiEnvelope<T>
}

function updateTenantRoute(tenantCode: string) {
  if (scope.value === 'dashboard') {
    router.replace({
      query: {
        ...route.query,
        tenantCode: tenantCode || undefined
      }
    })
    return
  }

  if (tenantCode) {
    router.push({
      path: '/dashboard',
      query: { tenantCode }
    })
  }
}

function applyTenantContext(tenantCode: string) {
  const normalized = tenantCode.trim()
  if (normalized) {
    setCurrentTenantCode(normalized)
  } else {
    clearCurrentTenantCode()
  }

  clearAuthorizationCache()
  updateTenantRoute(normalized)
  void loadAuthorization()
}

function chooseTenantCode(preferredTenantCode = '') {
  const preferred = preferredTenantCode.trim()
  if (preferred && tenantItems.value.some(item => item.tenantCode === preferred)) {
    return preferred
  }

  if (activeTenantCode.value && tenantItems.value.some(item => item.tenantCode === activeTenantCode.value)) {
    return activeTenantCode.value
  }

  return tenantItems.value[0]?.tenantCode || ''
}

async function loadTenantItems() {
  tenantsPending.value = true
  tenantsError.value = null

  try {
    const response = await fetchApi<{ items: TenantItem[], total: number }>(consoleTenantsApi)
    tenantItems.value = response.data.items

    if (scope.value === 'dashboard') {
      const routeTenantCode = typeof route.query.tenantCode === 'string' ? route.query.tenantCode.trim() : ''
      const nextTenantCode = chooseTenantCode(routeTenantCode)
      if (nextTenantCode && nextTenantCode !== activeTenantCode.value) {
        applyTenantContext(nextTenantCode)
      }
    }
  } catch (error) {
    tenantItems.value = []
    tenantsError.value = extractErrorMessage(error, '企业列表加载失败')
  } finally {
    tenantsPending.value = false
  }
}

function switchTenant(tenantCode: string) {
  if (!tenantCode || tenantCode === activeTenantCode.value) return
  applyTenantContext(tenantCode)
}

function openCreateTenant() {
  createTenantError.value = null
  createTenantOpen.value = true
}

function resetCreateTenantForm() {
  createTenantForm.tenantName = ''
  createTenantForm.displayName = ''
  createTenantForm.industryCategory = ''
  createTenantForm.companySize = ''
  createTenantForm.province = ''
  createTenantForm.city = ''
  createTenantForm.defaultDeploymentMode = 'managed-control-plane'
}

async function submitCreateTenant() {
  if (!createTenantForm.tenantName.trim()) {
    createTenantError.value = '企业名称不能为空'
    return
  }

  createTenantPending.value = true
  createTenantError.value = null

  try {
    const response = await fetchApi<TenantItem>(consoleTenantsApi, {
      method: 'POST',
      body: JSON.stringify({
        tenantName: createTenantForm.tenantName.trim(),
        displayName: createTenantForm.displayName.trim() || null,
        tenantType: 'enterprise',
        industryCategory: createTenantForm.industryCategory || null,
        companySize: createTenantForm.companySize || null,
        province: createTenantForm.province.trim() || null,
        city: createTenantForm.city.trim() || null,
        defaultDeploymentMode: createTenantForm.defaultDeploymentMode
      })
    })

    const createdTenant = response.data
    tenantItems.value = [
      createdTenant,
      ...tenantItems.value.filter(item => item.tenantCode !== createdTenant.tenantCode)
    ]
    applyTenantContext(createdTenant.tenantCode)
    resetCreateTenantForm()
    createTenantOpen.value = false
    toast.add({
      title: '企业已创建',
      description: `${tenantDisplayName(createdTenant)} 已设为当前企业。`,
      color: 'success'
    })
  } catch (error) {
    createTenantError.value = extractErrorMessage(error, '企业创建失败')
  } finally {
    createTenantPending.value = false
  }
}

function handleLogout() {
  void auth.logout({
    scope: scope.value,
    redirect: scope.value === 'admin' ? '/admin/login' : '/dashboard/login'
  })
}

onMounted(() => {
  void loadTenantItems()
  void loadAuthorization()
})

watch([() => route.path, activeTenantCode], () => {
  clearAuthorizationCache()
  void loadAuthorization()
})
</script>

<template>
  <div
    class="console-v2"
    :class="`console-v2--${scope}`"
  >
    <header class="console-topbar">
      <div class="row gap-1.5">
        <NuxtLink
          to="/"
          class="brand"
        >
          <img
            src="/logo.svg"
            alt="汇智云"
            class="h-6 w-6"
          >
          <span>{{ scope === 'dashboard' ? '汇智云 企业控制台' : '汇智云' }}</span>
        </NuxtLink>
        <span class="brand-divider">|</span>
        <UDropdownMenu :items="tenantMenuItems">
          <UButton
            color="neutral"
            variant="ghost"
            size="md"
            trailing-icon="i-lucide-chevrons-up-down"
            class="tenant-switcher"
            :loading="tenantsPending"
          >
            <span class="truncate">{{ tenantSwitcherLabel }}</span>
          </UButton>
        </UDropdownMenu>
      </div>

      <div class="topbar-actions">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-search"
          class="text-muted"
        >
          搜索...
          <UKbd
            value="meta"
            size="sm"
          />
          <UKbd
            value="K"
            size="sm"
          />
        </UButton>
        <UTooltip
          v-if="refreshHandler"
          text="刷新"
        >
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-refresh-cw"
            square
            @click="triggerRefresh"
          />
        </UTooltip>
        <UTooltip text="文档">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-circle-help"
            square
          />
        </UTooltip>
        <UTooltip text="通知">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-bell"
            square
          />
        </UTooltip>
        <UDropdownMenu :items="userMenuItems">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            trailing-icon="i-lucide-chevron-down"
            class="pl-1.5"
          >
            <UAvatar
              :alt="displayUser"
              size="xs"
              :ui="{ fallback: 'text-[11px] font-semibold' }"
            >
              {{ initials }}
            </UAvatar>
            <span class="user-name">{{ displayUser }}</span>
          </UButton>
        </UDropdownMenu>
      </div>
    </header>

    <aside class="console-sidebar">
      <div
        v-for="group in activeMenuGroups"
        :key="group.group"
        class="nav-group"
      >
        <div class="nav-group-label">
          {{ group.group }}
        </div>
        <UButton
          v-for="item in group.items"
          :key="item.key"
          :to="item.disabled ? undefined : item.to"
          :icon="item.icon || 'i-lucide-circle'"
          :label="item.label"
          :disabled="item.disabled"
          :active="isActivePath(item.to)"
          :color="isActivePath(item.to) ? 'primary' : 'neutral'"
          :variant="isActivePath(item.to) ? 'soft' : 'ghost'"
          size="sm"
          block
          class="justify-start"
          :ui="{ trailingIcon: 'ms-auto' }"
        >
          <template
            v-if="item.badge"
            #trailing
          >
            <UBadge
              color="neutral"
              variant="soft"
              size="sm"
              class="ml-auto font-mono"
            >
              {{ item.badge }}
            </UBadge>
          </template>
        </UButton>
      </div>
    </aside>

    <main class="console-main">
      <div class="console-content">
        <slot />
      </div>
    </main>

    <UModal
      v-model:open="createTenantOpen"
      title="新建企业"
      :ui="{ content: 'max-w-2xl', footer: 'flex justify-end gap-2' }"
    >
      <template #body>
        <div class="grid gap-4 md:grid-cols-2">
          <div
            v-if="createTenantError"
            class="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error md:col-span-2"
          >
            {{ createTenantError }}
          </div>

          <UFormField
            label="企业名称"
            required
          >
            <UInput
              v-model="createTenantForm.tenantName"
              class="w-full"
              placeholder="例如：汇智云科技有限公司"
            />
          </UFormField>

          <UFormField label="企业简称">
            <UInput
              v-model="createTenantForm.displayName"
              class="w-full"
              placeholder="例如：汇智云"
            />
          </UFormField>

          <UFormField label="行业分类">
            <USelect
              v-model="createTenantForm.industryCategory"
              class="w-full"
              :items="industryCategoryItems"
              placeholder="选择 GB/T 4754-2017 门类"
            />
          </UFormField>

          <UFormField label="企业规模">
            <USelect
              v-model="createTenantForm.companySize"
              class="w-full"
              :items="companySizeItems"
              placeholder="选择企业规模"
            />
          </UFormField>

          <UFormField label="所在省">
            <UInput
              v-model="createTenantForm.province"
              class="w-full"
              placeholder="例如：山东省"
            />
          </UFormField>

          <UFormField label="所在市">
            <UInput
              v-model="createTenantForm.city"
              class="w-full"
              placeholder="例如：青岛市"
            />
          </UFormField>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="createTenantPending"
            @click="createTenantOpen = false"
          >
            取消
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-check"
            :loading="createTenantPending"
            @click="submitCreateTenant"
          >
            创建并切换
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
