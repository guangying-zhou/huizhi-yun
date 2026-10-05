<script setup lang="ts">
usePageTitle('应用管理')

type AppType = 'internal' | 'external' | 'system'
type RuntimeMode = 'customer-hosted' | 'managed-control-plane' | 'self-hosted-enterprise'
type AuthMode = 'oidc' | 'gitlab_oidc' | 'cas' | 'wecom' | 'service'
type AppStatus = 'active' | 'suspended' | 'disabled'

interface ApplicationItem {
  id: number
  appCode: string
  appName: string
  description: string | null
  appType: AppType
  runtimeMode: RuntimeMode
  authMode: AuthMode
  bundleEnabled: boolean
  status: AppStatus
  createdAt: string
  updatedAt: string
  icon?: string | null
  homeUrl?: string | null
  repoUrl?: string | null
}

interface ApplicationListResponse {
  items: ApplicationItem[]
  total: number
  page: number
  pageSize: number
}

const appTypeOptions = [
  { value: '', label: '全部类型' },
  { value: 'internal', label: 'Internal' },
  { value: 'external', label: 'External' },
  { value: 'system', label: 'System' }
]

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'suspended', label: '暂停' },
  { value: 'disabled', label: '停用' }
]

const router = useRouter()

const filters = reactive({
  keyword: '',
  appType: '',
  status: ''
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

const applications = ref<ApplicationItem[]>([])
const listPending = ref(false)
const notice = ref<{ type: 'success' | 'error', message: string } | null>(null)

async function loadApplications() {
  listPending.value = true
  notice.value = null

  try {
    const response = await platformFetchJson<{ success: true, data: ApplicationListResponse }>('/api/platform/ops/applications', {
      query: {
        keyword: filters.keyword || undefined,
        appType: filters.appType || undefined,
        status: filters.status || undefined,
        page: pagination.page,
        pageSize: pagination.pageSize
      }
    })

    applications.value = response.data.items
    pagination.total = response.data.total
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '应用列表加载失败'
    }
  } finally {
    listPending.value = false
  }
}

const debouncedReload = useDebounceFn(() => {
  pagination.page = 1
  loadApplications()
}, 250)

watch(() => filters.keyword, debouncedReload)
watch(() => filters.appType, () => {
  pagination.page = 1
  loadApplications()
})
watch(() => filters.status, () => {
  pagination.page = 1
  loadApplications()
})
watch(() => pagination.page, () => {
  loadApplications()
})

function openApplication(application: ApplicationItem) {
  router.push(`/admin/applications/${application.id}`)
}

function goCreate() {
  router.push('/admin/applications/new')
}

function formatDate(value: string | null) {
  if (!value) {
    return '—'
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

const totalPages = computed(() => Math.max(1, Math.ceil(pagination.total / pagination.pageSize)))

onMounted(() => {
  loadApplications()
})
</script>

<template>
  <UDashboardPanel
    id="platform-applications-list"
    :ui="{ body: 'gap-4 sm:p-4' }"
  >
    <template #body>
      <UCard>
        <template #header>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                Application Management
              </p>
              <h1 class="text-xl font-semibold text-slate-900">
                应用管理
              </h1>
              <p class="mt-1 text-sm text-slate-600">
                围绕应用接入、能力发现、授权铺底与版本审计管理平台上所有已接入应用。
              </p>
            </div>

            <div class="flex items-center gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-refresh-cw"
                :loading="listPending"
                @click="loadApplications"
              >
                刷新
              </UButton>
              <UButton
                color="primary"
                icon="i-lucide-plus"
                @click="goCreate"
              >
                新增应用
              </UButton>
            </div>
          </div>
        </template>

        <div class="space-y-4">
          <div class="grid gap-3 md:grid-cols-4">
            <label class="tenant-field md:col-span-2">
              <span class="tenant-field__label">关键字</span>
              <UInput
                v-model="filters.keyword"
                placeholder="搜索 appCode / appName / 描述"
                icon="i-lucide-search"
              />
            </label>

            <label class="tenant-field">
              <span class="tenant-field__label">appType</span>
              <select
                v-model="filters.appType"
                class="tenant-native-field"
              >
                <option
                  v-for="option in appTypeOptions"
                  :key="option.value || 'all'"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>

            <label class="tenant-field">
              <span class="tenant-field__label">status</span>
              <select
                v-model="filters.status"
                class="tenant-native-field"
              >
                <option
                  v-for="option in statusOptions"
                  :key="option.value || 'all'"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
          </div>

          <div
            v-if="notice"
            class="tenant-notice"
            :data-tone="notice.type"
          >
            {{ notice.message }}
          </div>

          <div class="overflow-hidden rounded-2xl border border-slate-200">
            <table class="min-w-full divide-y divide-slate-200 text-sm">
              <thead class="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th class="px-4 py-3 text-left font-medium">
                    应用
                  </th>
                  <th class="px-4 py-3 text-left font-medium">
                    appCode
                  </th>
                  <th class="px-4 py-3 text-left font-medium">
                    运行模式
                  </th>
                  <th class="px-4 py-3 text-left font-medium">
                    Bundle / Repo
                  </th>
                  <th class="px-4 py-3 text-left font-medium">
                    状态
                  </th>
                  <th class="px-4 py-3 text-left font-medium">
                    更新时间
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 bg-white">
                <tr
                  v-for="application in applications"
                  :key="application.id"
                  class="cursor-pointer transition hover:bg-sky-50/60"
                  @click="openApplication(application)"
                >
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-3">
                      <img
                        v-if="application.icon"
                        :src="application.icon"
                        class="size-9 rounded-lg border border-slate-200 bg-white p-1 object-contain"
                        alt=""
                      >
                      <div
                        v-else
                        class="flex size-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400"
                      >
                        <UIcon
                          name="i-lucide-box"
                          class="size-5"
                        />
                      </div>
                      <div class="min-w-0">
                        <button
                          type="button"
                          class="block truncate text-left text-sm font-semibold text-sky-700 hover:underline"
                          @click.stop="openApplication(application)"
                        >
                          {{ application.appName }}
                        </button>
                        <p class="truncate text-xs text-slate-500">
                          {{ application.description || '未设置描述' }}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-slate-700">
                    <UBadge
                      variant="soft"
                      color="neutral"
                    >
                      {{ application.appCode }}
                    </UBadge>
                  </td>
                  <td class="px-4 py-3 text-slate-600">
                    <p>{{ application.runtimeMode }}</p>
                    <p class="text-xs text-slate-500">
                      {{ application.authMode }}
                    </p>
                  </td>
                  <td class="px-4 py-3 text-slate-600">
                    <p>
                      Bundle：{{ application.bundleEnabled ? '启用' : '关闭' }}
                    </p>
                    <p class="text-xs text-slate-500">
                      Repo：{{ application.repoUrl ? '已配置' : '未配置' }}
                    </p>
                  </td>
                  <td class="px-4 py-3">
                    <UBadge
                      :color="application.status === 'active' ? 'success' : application.status === 'suspended' ? 'warning' : 'neutral'"
                      variant="soft"
                    >
                      {{ application.status }}
                    </UBadge>
                  </td>
                  <td class="px-4 py-3 text-xs text-slate-500">
                    {{ formatDate(application.updatedAt) }}
                  </td>
                </tr>

                <tr v-if="!listPending && applications.length === 0">
                  <td
                    colspan="6"
                    class="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    暂无应用记录，点击右上角「新增应用」创建第一个。
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="flex items-center justify-between text-sm text-slate-600">
            <p>共 {{ pagination.total }} 条 · 第 {{ pagination.page }} / {{ totalPages }} 页</p>
            <div class="flex items-center gap-2">
              <UButton
                color="neutral"
                variant="soft"
                :disabled="pagination.page <= 1 || listPending"
                @click="pagination.page -= 1"
              >
                上一页
              </UButton>
              <UButton
                color="neutral"
                variant="soft"
                :disabled="pagination.page >= totalPages || listPending"
                @click="pagination.page += 1"
              >
                下一页
              </UButton>
            </div>
          </div>
        </div>
      </UCard>
    </template>
  </UDashboardPanel>
</template>
