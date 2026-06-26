<script setup lang="ts">
usePageTitle('新增应用')

type AppType = 'internal' | 'external' | 'system'
type RuntimeMode = 'customer-hosted' | 'managed-control-plane' | 'self-hosted-enterprise'
type AuthMode = 'oidc' | 'gitlab_oidc' | 'cas' | 'wecom' | 'service'
type AppStatus = 'active' | 'suspended' | 'disabled'

type CreateMode = 'gitlab' | 'manual'

interface FetchLikeError {
  data?: {
    code?: string
    appCode?: string
    message?: string
    statusMessage?: string
    statusCode?: number
  }
  status?: number
  statusCode?: number
  statusMessage?: string
  message?: string
}

interface GitLabReleaseItem {
  tagName: string
  name: string
  description: string | null
  releasedAt: string | null
  createdAt: string | null
  commitSha: string | null
  upcoming: boolean
}

interface ManifestPreview {
  manifestJson: Record<string, unknown>
  gitlab: {
    repoUrl: string
    ref: string
    commitSha: string
    manifestPath: string
  }
}

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
  callbackUrl?: string | null
  logoutUrl?: string | null
  repoUrl?: string | null
}

const appTypeOptions = [
  { value: 'internal', label: 'Internal' },
  { value: 'external', label: 'External' },
  { value: 'system', label: 'System' }
]

const runtimeModeOptions = [
  { value: 'customer-hosted', label: 'Customer Hosted' },
  { value: 'managed-control-plane', label: 'Managed Control Plane' },
  { value: 'self-hosted-enterprise', label: 'Self-Hosted Enterprise' }
]

const authModeOptions = [
  { value: 'oidc', label: 'OIDC' },
  { value: 'gitlab_oidc', label: 'GitLab OIDC' },
  { value: 'cas', label: 'CAS' },
  { value: 'wecom', label: '企业微信' },
  { value: 'service', label: 'Service' }
]

const statusOptions = [
  { value: 'active', label: '启用' },
  { value: 'suspended', label: '暂停' },
  { value: 'disabled', label: '停用' }
]

const router = useRouter()

const mode = ref<CreateMode>('gitlab')
const notice = ref<{ type: 'success' | 'error', message: string } | null>(null)

const gitlab = reactive({
  repoUrl: '',
  manifestPath: 'app.manifest.json',
  selectedTag: ''
})
const releases = ref<GitLabReleaseItem[]>([])
const releasesPending = ref(false)
const releaseQueried = ref(false)

const preview = ref<ManifestPreview | null>(null)
const previewPending = ref(false)

const form = reactive({
  appCode: '',
  appName: '',
  description: '',
  appType: 'internal' as AppType,
  runtimeMode: 'customer-hosted' as RuntimeMode,
  authMode: 'oidc' as AuthMode,
  bundleEnabled: true,
  status: 'active' as AppStatus,
  icon: '',
  homeUrl: '',
  callbackUrl: '',
  logoutUrl: '',
  repoUrl: ''
})

const submitPending = ref(false)

function resetNotice() {
  notice.value = null
}

function readStringField(source: Record<string, unknown> | null | undefined, key: string): string {
  if (!source) return ''
  const value = source[key]
  return typeof value === 'string' ? value : ''
}

function isAbsoluteHttpUrl(value: string) {
  return /^https?:\/\//i.test(value.trim())
}

function applyManifestToForm(manifestJson: Record<string, unknown>) {
  form.appCode = readStringField(manifestJson, 'appCode') || form.appCode
  form.appName = readStringField(manifestJson, 'appName') || form.appName
  form.description = readStringField(manifestJson, 'description') || form.description
  form.icon = readStringField(manifestJson, 'icon') || form.icon

  const entry = manifestJson.entry && typeof manifestJson.entry === 'object' && !Array.isArray(manifestJson.entry)
    ? manifestJson.entry as Record<string, unknown>
    : null

  const web = readStringField(entry, 'web')
  if (web && isAbsoluteHttpUrl(web)) {
    form.homeUrl = web
  }
}

const fetchJson = $fetch as <T>(request: string, options?: {
  method?: string
  query?: Record<string, string>
  body?: Record<string, unknown>
}) => Promise<T>

async function loadReleases() {
  if (!gitlab.repoUrl.trim()) {
    notice.value = { type: 'error', message: '请先填写 GitLab 仓库地址' }
    return
  }

  releasesPending.value = true
  releaseQueried.value = true
  resetNotice()

  try {
    const response = await fetchJson<{ success: true, data: { items: GitLabReleaseItem[] } }>(
      '/api/platform/ops/app-manifest-imports/gitlab-releases',
      {
        query: { repoUrl: gitlab.repoUrl.trim() }
      }
    )
    releases.value = response.data.items
    if (!response.data.items.length) {
      notice.value = { type: 'error', message: '该仓库暂未发布任何 Release。' }
    }
  } catch (error) {
    const fetchError = error as FetchLikeError
    notice.value = {
      type: 'error',
      message: fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || '拉取 Release 列表失败'
    }
    releases.value = []
  } finally {
    releasesPending.value = false
  }
}

async function loadManifestPreview() {
  if (!gitlab.selectedTag) {
    notice.value = { type: 'error', message: '请先选择一个 Release 版本' }
    return
  }

  previewPending.value = true
  resetNotice()

  try {
    const response = await fetchJson<{ success: true, data: ManifestPreview }>(
      '/api/platform/ops/app-manifest-imports/preview',
      {
        query: {
          repoUrl: gitlab.repoUrl.trim(),
          ref: gitlab.selectedTag,
          manifestPath: gitlab.manifestPath.trim() || 'app.manifest.json'
        }
      }
    )

    preview.value = response.data
    applyManifestToForm(response.data.manifestJson)
    form.repoUrl = gitlab.repoUrl.trim()
    notice.value = {
      type: 'success',
      message: `已读取 manifest：${form.appCode || '(未声明 appCode)'}`
    }
  } catch (error) {
    const fetchError = error as FetchLikeError
    notice.value = {
      type: 'error',
      message: fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || '读取 manifest 失败'
    }
    preview.value = null
  } finally {
    previewPending.value = false
  }
}

function validateForm() {
  if (!form.appCode.trim()) {
    throw new Error('appCode 不能为空')
  }
  if (!form.appName.trim()) {
    throw new Error('appName 不能为空')
  }
}

function createErrorMessage(error: unknown, fallback: string) {
  const fetchError = error as FetchLikeError
  const statusCode = fetchError.statusCode || fetchError.status || fetchError.data?.statusCode

  if (statusCode === 409 || fetchError.data?.code === 'APPLICATION_ALREADY_EXISTS') {
    const appCode = fetchError.data?.appCode || form.appCode.trim() || '该应用'
    return `${appCode} 已存在，不能重复导入。请进入应用详情页，通过“从 GitLab 导入新 manifest 版本”更新 release。`
  }

  return fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || fallback
}

async function submitFromGitLab() {
  if (!preview.value) {
    notice.value = { type: 'error', message: '请先读取 manifest' }
    return
  }

  submitPending.value = true
  resetNotice()

  try {
    validateForm()

    const response = await fetchJson<{ success: true, data: { application: ApplicationItem } }>(
      '/api/platform/ops/applications/from-manifest',
      {
        method: 'POST',
        body: {
          repoUrl: gitlab.repoUrl.trim(),
          version: gitlab.selectedTag,
          ref: gitlab.selectedTag,
          manifestPath: gitlab.manifestPath.trim() || 'app.manifest.json',
          commitSha: preview.value.gitlab.commitSha,
          appCode: form.appCode.trim(),
          appName: form.appName.trim(),
          description: form.description.trim() || null,
          appType: form.appType,
          runtimeMode: form.runtimeMode,
          authMode: form.authMode,
          bundleEnabled: form.bundleEnabled,
          status: form.status,
          icon: form.icon.trim() || null,
          homeUrl: form.homeUrl.trim() || null,
          callbackUrl: form.callbackUrl.trim() || null,
          logoutUrl: form.logoutUrl.trim() || null
        }
      }
    )

    notice.value = { type: 'success', message: '应用已创建并完成 manifest 注册。' }
    router.push(`/admin/applications/${response.data.application.id}`)
  } catch (error) {
    notice.value = {
      type: 'error',
      message: createErrorMessage(error, '创建应用失败')
    }
  } finally {
    submitPending.value = false
  }
}

async function submitManual() {
  submitPending.value = true
  resetNotice()

  try {
    validateForm()

    const response = await fetchJson<{ success: true, data: ApplicationItem }>(
      '/api/platform/ops/applications',
      {
        method: 'POST',
        body: {
          appCode: form.appCode.trim(),
          appName: form.appName.trim(),
          description: form.description.trim() || null,
          appType: form.appType,
          runtimeMode: form.runtimeMode,
          authMode: form.authMode,
          bundleEnabled: form.bundleEnabled,
          status: form.status,
          icon: form.icon.trim() || null,
          homeUrl: form.homeUrl.trim() || null,
          callbackUrl: form.callbackUrl.trim() || null,
          logoutUrl: form.logoutUrl.trim() || null,
          repoUrl: form.repoUrl.trim() || null
        }
      }
    )

    notice.value = { type: 'success', message: '应用已创建。' }
    router.push(`/admin/applications/${response.data.id}`)
  } catch (error) {
    const fetchError = error as FetchLikeError
    notice.value = {
      type: 'error',
      message: fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || '创建应用失败'
    }
  } finally {
    submitPending.value = false
  }
}

function handleSubmit() {
  if (mode.value === 'gitlab') {
    void submitFromGitLab()
  } else {
    void submitManual()
  }
}

function goBack() {
  router.push('/admin/applications')
}

function formatDate(value: string | null) {
  if (!value) {
    return '—'
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <UDashboardPanel
    id="platform-applications-create"
    :ui="{ body: 'gap-4 sm:p-4' }"
  >
    <template #body>
      <UCard>
        <template #header>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                New Application
              </p>
              <h1 class="text-xl font-semibold text-slate-900">
                新增应用
              </h1>
              <p class="mt-1 text-sm text-slate-600">
                推荐从 GitLab Release 导入 manifest 自动创建应用，也可在没有 Release 时手工登记。
              </p>
            </div>

            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-arrow-left"
              @click="goBack"
            >
              返回列表
            </UButton>
          </div>
        </template>

        <div class="space-y-6">
          <div class="grid gap-2 md:grid-cols-2">
            <button
              type="button"
              class="rounded-2xl border px-4 py-3 text-left transition"
              :class="mode === 'gitlab' ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-slate-200 bg-white hover:border-sky-200'"
              @click="mode = 'gitlab'"
            >
              <p class="flex items-center gap-2 text-sm font-semibold">
                <UIcon name="i-simple-icons-gitlab" />
                从 GitLab Release 导入
              </p>
              <p class="mt-1 text-xs text-slate-500">
                输入仓库地址 → 选择 Release 版本 → 读取 app.manifest.json → 创建应用并注册首个 manifest。
              </p>
            </button>

            <button
              type="button"
              class="rounded-2xl border px-4 py-3 text-left transition"
              :class="mode === 'manual' ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-slate-200 bg-white hover:border-sky-200'"
              @click="mode = 'manual'"
            >
              <p class="flex items-center gap-2 text-sm font-semibold">
                <UIcon name="i-lucide-pencil" />
                手工登记
              </p>
              <p class="mt-1 text-xs text-slate-500">
                没有 Release 时可手工填写应用基础信息，后续仍可在详情页再导入 manifest。
              </p>
            </button>
          </div>

          <div
            v-if="notice"
            class="tenant-notice"
            :data-tone="notice.type"
          >
            {{ notice.message }}
          </div>

          <section
            v-if="mode === 'gitlab'"
            class="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
          >
            <h2 class="text-base font-semibold text-slate-900">
              GitLab 源
            </h2>

            <div class="grid gap-3 md:grid-cols-[2fr_1fr]">
              <label class="tenant-field">
                <span class="tenant-field__label">repoUrl</span>
                <UInput
                  v-model="gitlab.repoUrl"
                  icon="i-simple-icons-gitlab"
                  placeholder="例如 https://gitlab.xxx.com/group/repo"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">manifestPath</span>
                <UInput
                  v-model="gitlab.manifestPath"
                  placeholder="app.manifest.json"
                />
              </label>
            </div>

            <div class="flex flex-wrap gap-2">
              <UButton
                color="primary"
                variant="soft"
                icon="i-lucide-list"
                :loading="releasesPending"
                :disabled="!gitlab.repoUrl.trim()"
                @click="loadReleases"
              >
                拉取 Release 列表
              </UButton>
            </div>

            <div
              v-if="releaseQueried"
              class="grid gap-3"
            >
              <p class="text-sm text-slate-600">
                共 {{ releases.length }} 个 Release。选择一个以读取 manifest。
              </p>

              <div class="grid gap-2 md:grid-cols-2">
                <button
                  v-for="release in releases"
                  :key="release.tagName"
                  type="button"
                  class="rounded-2xl border px-3 py-3 text-left transition"
                  :class="gitlab.selectedTag === release.tagName ? 'border-sky-300 bg-white' : 'border-slate-200 bg-white hover:border-sky-200'"
                  @click="gitlab.selectedTag = release.tagName"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-semibold text-slate-900">
                        {{ release.name }}
                      </p>
                      <p class="truncate text-xs text-slate-500">
                        tag: {{ release.tagName }}
                      </p>
                    </div>
                    <UBadge
                      v-if="release.upcoming"
                      color="warning"
                      variant="soft"
                    >
                      upcoming
                    </UBadge>
                  </div>
                  <p class="mt-1 text-xs text-slate-500">
                    发布于 {{ formatDate(release.releasedAt || release.createdAt) }}
                  </p>
                </button>
              </div>

              <div class="flex flex-wrap gap-2">
                <UButton
                  color="primary"
                  icon="i-lucide-file-search"
                  :loading="previewPending"
                  :disabled="!gitlab.selectedTag"
                  @click="loadManifestPreview"
                >
                  读取 manifest
                </UButton>
              </div>
            </div>
          </section>

          <section
            v-if="mode === 'gitlab' && preview"
            class="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-4"
          >
            <h2 class="text-base font-semibold text-slate-900">
              manifest 预览（{{ gitlab.selectedTag }}）
            </h2>
            <p class="text-xs text-slate-500">
              commit: {{ preview.gitlab.commitSha }}
            </p>
            <pre class="max-h-64 overflow-auto rounded-xl bg-slate-900 px-3 py-2 text-xs text-slate-100">{{ JSON.stringify(preview.manifestJson, null, 2) }}</pre>
          </section>

          <form
            class="space-y-4 rounded-2xl border border-slate-200 bg-white px-4 py-4"
            @submit.prevent="handleSubmit"
          >
            <h2 class="text-base font-semibold text-slate-900">
              接入资料
            </h2>
            <p class="text-xs text-slate-500">
              {{ mode === 'gitlab' ? '已从 manifest 自动预填，可根据需要修改后保存。' : '请完整填写基础信息；后续仍可在详情页导入 manifest。' }}
            </p>

            <div class="grid gap-3 md:grid-cols-2">
              <label class="tenant-field">
                <span class="tenant-field__label">appCode</span>
                <UInput
                  v-model="form.appCode"
                  placeholder="应用稳定编码"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">appName</span>
                <UInput
                  v-model="form.appName"
                  placeholder="应用名称"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">appType</span>
                <select
                  v-model="form.appType"
                  class="tenant-native-field"
                >
                  <option
                    v-for="option in appTypeOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">runtimeMode</span>
                <select
                  v-model="form.runtimeMode"
                  class="tenant-native-field"
                >
                  <option
                    v-for="option in runtimeModeOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">authMode</span>
                <select
                  v-model="form.authMode"
                  class="tenant-native-field"
                >
                  <option
                    v-for="option in authModeOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">status</span>
                <select
                  v-model="form.status"
                  class="tenant-native-field"
                >
                  <option
                    v-for="option in statusOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">bundleEnabled</span>
                <div class="flex h-full items-center rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <USwitch v-model="form.bundleEnabled" />
                </div>
              </label>

              <label class="tenant-field md:col-span-2">
                <span class="tenant-field__label">description</span>
                <UTextarea
                  v-model="form.description"
                  :rows="3"
                  placeholder="描述这个应用在平台中的职责与边界"
                />
              </label>

              <label class="tenant-field md:col-span-2">
                <span class="tenant-field__label">icon</span>
                <UInput
                  v-model="form.icon"
                  placeholder="例如 i-lucide-monitor-cog，或图标资源地址"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">homeUrl</span>
                <UInput
                  v-model="form.homeUrl"
                  placeholder="应用主页地址"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">callbackUrl</span>
                <UInput
                  v-model="form.callbackUrl"
                  placeholder="登录回调地址"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">logoutUrl</span>
                <UInput
                  v-model="form.logoutUrl"
                  placeholder="登出回调地址"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">repoUrl</span>
                <UInput
                  v-model="form.repoUrl"
                  icon="i-simple-icons-gitlab"
                  placeholder="GitLab 仓库地址"
                />
              </label>
            </div>

            <div class="flex flex-wrap gap-2">
              <UButton
                color="primary"
                :loading="submitPending"
                :disabled="mode === 'gitlab' && !preview"
                type="submit"
              >
                {{ mode === 'gitlab' ? '创建应用并注册 manifest' : '创建应用' }}
              </UButton>
              <UButton
                color="neutral"
                variant="soft"
                type="button"
                @click="goBack"
              >
                取消
              </UButton>
            </div>
          </form>
        </div>
      </UCard>
    </template>
  </UDashboardPanel>
</template>
