<script setup lang="ts">
const props = defineProps<{
  applicationId: number
}>()

type AppType = 'internal' | 'external' | 'system'
type RuntimeMode = 'customer-hosted' | 'managed-control-plane' | 'self-hosted-enterprise'
type AuthMode = 'oidc' | 'gitlab_oidc' | 'cas' | 'wecom' | 'service'
type AppStatus = 'active' | 'suspended' | 'disabled'
type AppReleaseStatus = 'draft' | 'permissions_pending' | 'ready' | 'released' | 'deprecated'

type LedgerTab = 'basic' | 'resources' | 'roles' | 'templates' | 'history'

interface FetchLikeError {
  data?: {
    message?: string
    statusMessage?: string
  }
  statusMessage?: string
  message?: string
}

const fetchJson = $fetch as <T>(request: string, options?: {
  method?: string
  query?: Record<string, unknown>
  body?: Record<string, unknown>
}) => Promise<T>

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

interface ManifestItem {
  id: number
  appCode: string
  manifestSeq: number
  manifestHash: string
  manifestJson: Record<string, unknown>
  status: string
  createdAt: string
}

interface ApplicationReleaseItem {
  id: number
  appCode: string
  releaseVersion: string
  sourceTag: string
  sourceCommitSha: string | null
  manifestId: number
  manifestSeq: number
  manifestHash: string
  status: AppReleaseStatus
  bundleUri: string | null
  bundleHash: string | null
  bundleSizeBytes: number | null
  releasedAt: string | null
  createdAt: string
  updatedAt: string
  isLatestReleased: boolean
  resourceCount: number
  actionCount: number
  missingGrantActionCount: number
  missingActions: string[]
}

interface ManifestResourceItem {
  code: string
  name: string
  description: string | null
  actions: string[]
  sortOrder: number
}

interface SuggestedRoleItem {
  code: string
  name: string
  description: string | null
  suggestedPermissions: string[]
}

interface PlatformRoleItem {
  id: number
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  description: string | null
  isSystem: boolean
  isAssignable: boolean
  status: string
}

interface PlatformTemplateItem {
  id: number
  templateCode: string
  templateName: string
  templateType: string
  description: string | null
  status: string
  sortOrder: number
  roleCount: number
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

const tabs: Array<{ key: LedgerTab, label: string, hint: string }> = [
  { key: 'basic', label: '接入资料', hint: '应用身份、运行模式与入口' },
  { key: 'resources', label: '能力发现', hint: 'manifest、资源、scope 与 capability' },
  { key: 'roles', label: '应用权限角色', hint: '平台侧应用角色' },
  { key: 'templates', label: '模板方案', hint: '可复用的授权组合' },
  { key: 'history', label: '应用版本', hint: 'release 状态、manifest 与发布' }
]

const statusOptions = [
  { value: 'active', label: '启用' },
  { value: 'suspended', label: '暂停' },
  { value: 'disabled', label: '停用' }
]

const router = useRouter()

const activeTab = ref<LedgerTab>('basic')
const application = ref<ApplicationItem | null>(null)
const manifests = ref<ManifestItem[]>([])
const appReleases = ref<ApplicationReleaseItem[]>([])
const appRoles = ref<PlatformRoleItem[]>([])
const appTemplates = ref<PlatformTemplateItem[]>([])
const releases = ref<GitLabReleaseItem[]>([])
const releasesPending = ref(false)
const releasesLoaded = ref(false)

const applicationPending = ref(false)
const formPending = ref(false)
const manifestPending = ref(false)
const gitlabImportPending = ref(false)
const manifestsPending = ref(false)
const appReleasesPending = ref(false)
const rolesPending = ref(false)
const templatesPending = ref(false)
const releaseActionPendingId = ref<number | null>(null)
const deletePending = ref(false)
const notice = ref<{ type: 'success' | 'error', message: string } | null>(null)

usePageTitle('应用详情')

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

const manifestForm = reactive({
  version: '',
  manifestJson: ''
})

const gitlabImportForm = reactive({
  version: '',
  ref: '',
  manifestPath: 'app.manifest.json'
})

const latestManifest = computed(() => manifests.value[0] || null)
const latestReleasedVersion = computed(() => appReleases.value.find(release => release.isLatestReleased) || null)
const releaseWarningCount = computed(() => appReleases.value.filter(release => release.missingGrantActionCount > 0).length)
const unreleasedCount = computed(() => appReleases.value.filter(release => release.status !== 'released' && release.status !== 'deprecated').length)

const discoveredResources = computed<ManifestResourceItem[]>(() => {
  const raw = latestManifest.value?.manifestJson?.resources
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .map((item, index) => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : null
      const code = String(record?.code || '').trim()
      if (!code) {
        return null
      }

      const actions = Array.isArray(record?.actions)
        ? record.actions.map(value => String(value || '').trim()).filter(Boolean)
        : []

      return {
        code,
        name: String(record?.name || code).trim() || code,
        description: record?.description ? String(record.description) : null,
        actions,
        sortOrder: Number(record?.sortOrder ?? index + 1)
      }
    })
    .filter((item): item is ManifestResourceItem => Boolean(item))
    .sort((a, b) => a.sortOrder - b.sortOrder)
})

const suggestedRoles = computed<SuggestedRoleItem[]>(() => {
  const raw = latestManifest.value?.manifestJson?.recommendedRoles
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .map((item) => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : null
      const code = String(record?.code || '').trim()
      if (!code) {
        return null
      }

      return {
        code,
        name: String(record?.name || code).trim() || code,
        description: record?.description ? String(record.description) : null,
        suggestedPermissions: Array.isArray(record?.suggestedPermissions)
          ? record.suggestedPermissions.map(value => String(value || '').trim()).filter(Boolean)
          : []
      }
    })
    .filter((item): item is SuggestedRoleItem => Boolean(item))
})

const supportedScopes = computed<string[]>(() => {
  const raw = latestManifest.value?.manifestJson?.supportedScopes
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.map(item => String(item || '').trim()).filter(Boolean)
})

const requiredCapabilities = computed<string[]>(() => {
  const raw = latestManifest.value?.manifestJson?.capabilitiesRequired
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.map(item => String(item || '').trim()).filter(Boolean)
})

function resetNotice() {
  notice.value = null
}

function resetManifestForm(payload?: Record<string, unknown>) {
  manifestForm.version = payload && typeof payload.version === 'string' ? payload.version : ''
  manifestForm.manifestJson = payload ? `${JSON.stringify(payload, null, 2)}\n` : ''
  gitlabImportForm.version = ''
  gitlabImportForm.ref = ''
  gitlabImportForm.manifestPath = 'app.manifest.json'
}

function fillForm(app: ApplicationItem) {
  form.appCode = app.appCode
  form.appName = app.appName
  form.description = app.description || ''
  form.appType = app.appType
  form.runtimeMode = app.runtimeMode
  form.authMode = app.authMode
  form.bundleEnabled = app.bundleEnabled
  form.status = app.status
  form.icon = app.icon || ''
  form.homeUrl = app.homeUrl || ''
  form.callbackUrl = app.callbackUrl || ''
  form.logoutUrl = app.logoutUrl || ''
  form.repoUrl = app.repoUrl || ''
}

async function loadApplication() {
  applicationPending.value = true
  resetNotice()

  try {
    const response = await fetchJson<{ success: true, data: ApplicationItem }>(
      `/api/platform/ops/applications/${props.applicationId}`
    )
    application.value = response.data
    fillForm(response.data)
  } catch (error) {
    const fetchError = error as FetchLikeError
    notice.value = {
      type: 'error',
      message: fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || '应用加载失败'
    }
  } finally {
    applicationPending.value = false
  }
}

async function loadManifests(appCode: string) {
  manifestsPending.value = true

  try {
    const response = await fetchJson<{ success: true, data: { items: ManifestItem[] } }>(
      `/api/platform/ops/applications/${appCode}/manifests`
    )
    manifests.value = response.data.items
    if (response.data.items[0]) {
      resetManifestForm(response.data.items[0].manifestJson)
    }
  } catch {
    manifests.value = []
    resetManifestForm()
  } finally {
    manifestsPending.value = false
  }
}

async function loadAppReleases(appCode: string) {
  appReleasesPending.value = true

  try {
    const response = await fetchJson<{ success: true, data: { items: ApplicationReleaseItem[] } }>(
      `/api/platform/ops/applications/${appCode}/releases`
    )
    appReleases.value = response.data.items
  } catch {
    appReleases.value = []
  } finally {
    appReleasesPending.value = false
  }
}

async function loadAppRoles(appCode: string) {
  rolesPending.value = true

  try {
    const response = await fetchJson<{ success: true, data: { items: PlatformRoleItem[] } }>(
      '/api/platform/ops/roles',
      { query: { appCode, page: 1, pageSize: 100 } }
    )
    appRoles.value = response.data.items
  } catch {
    appRoles.value = []
  } finally {
    rolesPending.value = false
  }
}

async function loadAppTemplates(appCode: string) {
  templatesPending.value = true

  try {
    const response = await fetchJson<{ success: true, data: { items: PlatformTemplateItem[] } }>(
      `/api/platform/ops/applications/${appCode}/templates`
    )
    appTemplates.value = response.data.items
  } catch {
    appTemplates.value = []
  } finally {
    templatesPending.value = false
  }
}

async function reloadRelated(appCode: string) {
  await Promise.all([
    loadManifests(appCode),
    loadAppReleases(appCode),
    loadAppRoles(appCode),
    loadAppTemplates(appCode)
  ])
}

async function bootstrap() {
  await loadApplication()
  if (application.value?.appCode) {
    await reloadRelated(application.value.appCode)
  }
}

function validateForm() {
  if (!form.appName.trim()) {
    throw new Error('appName 不能为空')
  }
}

async function submitApplicationForm() {
  if (!application.value) return
  formPending.value = true
  resetNotice()

  try {
    validateForm()
    const response = await fetchJson<{ success: true, data: ApplicationItem }>(
      `/api/platform/ops/applications/${application.value.id}`,
      {
        method: 'PATCH',
        body: {
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

    application.value = response.data
    fillForm(response.data)
    notice.value = { type: 'success', message: '应用信息已更新。' }
  } catch (error) {
    const fetchError = error as FetchLikeError
    notice.value = {
      type: 'error',
      message: fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || '保存失败'
    }
  } finally {
    formPending.value = false
  }
}

async function deleteApplication() {
  if (!application.value || !import.meta.client) return
  if (!window.confirm(`确定删除应用「${application.value.appName}」吗？`)) return

  deletePending.value = true
  resetNotice()

  try {
    await $fetch(`/api/platform/ops/applications/${application.value.id}`, { method: 'DELETE' })
    notice.value = { type: 'success', message: '应用已删除。' }
    router.push('/admin/applications')
  } catch (error) {
    const fetchError = error as FetchLikeError
    notice.value = {
      type: 'error',
      message: fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || '应用删除失败'
    }
  } finally {
    deletePending.value = false
  }
}

async function submitManifestForm() {
  if (!application.value) return
  manifestPending.value = true
  resetNotice()

  try {
    if (!manifestForm.version.trim()) {
      throw new Error('注册版本不能为空')
    }
    const manifestJson = JSON.parse(manifestForm.manifestJson)

    await $fetch(`/api/platform/ops/applications/${application.value.appCode}/manifests`, {
      method: 'POST',
      body: {
        version: manifestForm.version.trim(),
        manifestJson
      }
    })

    notice.value = { type: 'success', message: 'manifest 已注册。' }
    await reloadRelated(application.value.appCode)
  } catch (error) {
    const fetchError = error as FetchLikeError
    notice.value = {
      type: 'error',
      message: fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || 'manifest 注册失败'
    }
  } finally {
    manifestPending.value = false
  }
}

async function loadReleasesForImport() {
  if (!application.value?.repoUrl) return
  releasesPending.value = true
  releasesLoaded.value = true
  resetNotice()

  try {
    const response = await fetchJson<{ success: true, data: { items: GitLabReleaseItem[] } }>(
      '/api/platform/ops/app-manifest-imports/gitlab-releases',
      { query: { repoUrl: application.value.repoUrl } }
    )
    releases.value = response.data.items
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

async function importManifestFromGitLab() {
  if (!application.value) return
  gitlabImportPending.value = true
  resetNotice()

  try {
    if (!application.value.repoUrl) {
      throw new Error('请先在接入资料中配置 repoUrl')
    }
    if (!gitlabImportForm.version.trim()) {
      throw new Error('version 不能为空')
    }

    const response = await fetchJson<{ success: boolean, data?: { manifest?: ManifestItem, release?: ApplicationReleaseItem } }>(
      '/api/platform/ops/app-manifest-imports',
      {
        method: 'POST',
        body: {
          appCode: application.value.appCode,
          version: gitlabImportForm.version.trim(),
          ref: gitlabImportForm.ref.trim() || null,
          manifestPath: gitlabImportForm.manifestPath.trim() || 'app.manifest.json'
        }
      }
    )

    if (!response?.success || !response.data?.manifest) {
      throw new Error('GitLab manifest 导入接口未返回有效结果')
    }

    notice.value = {
      type: 'success',
      message: `已从 GitLab 导入并注册版本：${response.data.release?.releaseVersion || gitlabImportForm.version.trim()}`
    }

    await reloadRelated(application.value.appCode)
  } catch (error) {
    const fetchError = error as FetchLikeError
    notice.value = {
      type: 'error',
      message: fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || 'GitLab manifest 导入失败'
    }
  } finally {
    gitlabImportPending.value = false
  }
}

function pickRelease(release: GitLabReleaseItem) {
  gitlabImportForm.version = release.tagName
  gitlabImportForm.ref = release.tagName
}

async function updateReleaseStatus(release: ApplicationReleaseItem, status: AppReleaseStatus) {
  if (!application.value) return
  releaseActionPendingId.value = release.id
  resetNotice()

  try {
    const response = await fetchJson<{ success: true, data: ApplicationReleaseItem }>(
      `/api/platform/ops/applications/${application.value.appCode}/releases/${release.id}`,
      {
        method: 'PATCH',
        body: { status }
      }
    )

    const index = appReleases.value.findIndex(item => item.id === release.id)
    if (index >= 0) {
      appReleases.value[index] = response.data
    }
    if (status === 'released') {
      await loadAppReleases(application.value.appCode)
    }

    notice.value = {
      type: 'success',
      message: `版本 ${release.releaseVersion} 已更新为 ${status}。`
    }
  } catch (error) {
    const fetchError = error as FetchLikeError
    notice.value = {
      type: 'error',
      message: fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || '版本状态更新失败'
    }
  } finally {
    releaseActionPendingId.value = null
  }
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function shortHash(value: string | null) {
  if (!value) return '—'
  return value.length > 14 ? `${value.slice(0, 12)}…` : value
}

function releaseStatusColor(status: AppReleaseStatus) {
  if (status === 'released') return 'success'
  if (status === 'ready') return 'primary'
  if (status === 'permissions_pending') return 'warning'
  if (status === 'deprecated') return 'neutral'
  return 'info'
}

function resourceActionCount(resource: ManifestResourceItem) {
  return resource.actions.length || 0
}

function goBack() {
  router.push('/admin/applications')
}

onMounted(() => {
  bootstrap()
})

watch(() => props.applicationId, () => {
  bootstrap()
})
</script>

<template>
  <UDashboardPanel
    id="platform-application-detail"
    :ui="{ body: 'gap-4 sm:p-4' }"
  >
    <template #body>
      <UCard>
        <template #header>
          <div class="space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.24em] text-lime-700">
                  Application Detail
                </p>
                <h1 class="text-lg font-semibold text-slate-900">
                  {{ application?.appName || '加载中…' }}
                </h1>
                <p class="text-sm text-slate-600">
                  围绕应用接入、能力发现、授权铺底和版本审计推进可开通状态。
                </p>
              </div>

              <div class="flex items-center gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-arrow-left"
                  @click="goBack"
                >
                  返回列表
                </UButton>
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-refresh-cw"
                  :loading="applicationPending"
                  @click="bootstrap"
                >
                  刷新
                </UButton>
              </div>
            </div>

            <div
              v-if="application"
              class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
            >
              <p><strong class="text-slate-900">{{ application.appCode }}</strong> · {{ application.runtimeMode }} · {{ application.authMode }}</p>
            </div>

            <div class="grid gap-2 md:grid-cols-5">
              <button
                v-for="tab in tabs"
                :key="tab.key"
                type="button"
                class="rounded-2xl border px-3 py-3 text-left transition"
                :class="activeTab === tab.key ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-slate-200 bg-white hover:border-sky-200'"
                @click="activeTab = tab.key"
              >
                <p class="text-sm font-semibold">
                  {{ tab.label }}
                </p>
                <p class="mt-1 text-xs text-slate-500">
                  {{ tab.hint }}
                </p>
              </button>
            </div>
          </div>
        </template>

        <div
          v-if="notice"
          class="tenant-notice mb-4"
          :data-tone="notice.type"
        >
          {{ notice.message }}
        </div>

        <div
          v-if="activeTab === 'basic'"
          class="space-y-6"
        >
          <div class="grid gap-3 md:grid-cols-4">
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                Versions
              </p>
              <p class="mt-2 text-lg font-semibold text-slate-900">
                {{ appReleases.length }}
              </p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                Resources
              </p>
              <p class="mt-2 text-lg font-semibold text-slate-900">
                {{ discoveredResources.length }}
              </p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                Platform Roles
              </p>
              <p class="mt-2 text-lg font-semibold text-slate-900">
                {{ appRoles.length }}
              </p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                Templates
              </p>
              <p class="mt-2 text-lg font-semibold text-slate-900">
                {{ appTemplates.length }}
              </p>
            </div>
          </div>

          <form
            class="space-y-4"
            @submit.prevent="submitApplicationForm"
          >
            <div class="grid gap-3 md:grid-cols-2">
              <label class="tenant-field">
                <span class="tenant-field__label">appCode</span>
                <UInput
                  v-model="form.appCode"
                  readonly
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
                  placeholder="图标地址，可选"
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

              <label class="tenant-field md:col-span-2">
                <span class="tenant-field__label">repoUrl</span>
                <UInput
                  v-model="form.repoUrl"
                  icon="i-simple-icons-gitlab"
                  placeholder="GitLab 仓库地址，用于按版本读取 app.manifest.json"
                />
              </label>
            </div>

            <div class="flex flex-wrap gap-2">
              <UButton
                color="primary"
                :loading="formPending"
                type="submit"
              >
                保存接入资料
              </UButton>
              <UButton
                color="error"
                variant="soft"
                :loading="deletePending"
                type="button"
                @click="deleteApplication"
              >
                删除应用
              </UButton>
            </div>

            <div
              v-if="application"
              class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
            >
              <p><span class="font-medium text-slate-900">仓库地址：</span>{{ application.repoUrl || '未配置' }}</p>
              <p class="mt-1">
                创建时间：{{ formatDate(application.createdAt) }} · 更新时间：{{ formatDate(application.updatedAt) }}
              </p>
            </div>
          </form>
        </div>

        <div
          v-else-if="activeTab === 'resources'"
          class="space-y-6"
        >
          <div class="grid gap-3 md:grid-cols-4">
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                Latest Manifest
              </p>
              <p class="mt-2 text-lg font-semibold text-slate-900">
                {{ latestManifest ? `#${latestManifest.manifestSeq}` : '—' }}
              </p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                Discovered Resources
              </p>
              <p class="mt-2 text-lg font-semibold text-slate-900">
                {{ discoveredResources.length }}
              </p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                Suggested Roles
              </p>
              <p class="mt-2 text-lg font-semibold text-slate-900">
                {{ suggestedRoles.length }}
              </p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                Supported Scopes
              </p>
              <p class="mt-2 text-lg font-semibold text-slate-900">
                {{ supportedScopes.length }}
              </p>
            </div>
          </div>

          <div class="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <UCard>
              <template #header>
                <div class="space-y-1">
                  <h3 class="text-base font-semibold text-slate-900">
                    资源发现
                  </h3>
                  <p class="text-sm text-slate-600">
                    展示应用通过 manifest 已声明的资源与动作。
                  </p>
                </div>
              </template>

              <div class="grid gap-3">
                <div
                  v-for="resource in discoveredResources"
                  :key="resource.code"
                  class="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="space-y-1">
                      <p class="text-sm font-semibold text-slate-900">
                        {{ resource.name }}
                      </p>
                      <p class="text-xs text-slate-500">
                        {{ resource.code }}
                      </p>
                      <p class="text-sm text-slate-600">
                        {{ resource.description || '未设置说明' }}
                      </p>
                    </div>
                    <UBadge
                      color="neutral"
                      variant="soft"
                    >
                      {{ resourceActionCount(resource) }} actions
                    </UBadge>
                  </div>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <UBadge
                      v-for="action in resource.actions"
                      :key="action"
                      color="info"
                      variant="soft"
                    >
                      {{ action }}
                    </UBadge>
                  </div>
                </div>

                <div
                  v-if="!manifestsPending && discoveredResources.length === 0"
                  class="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500"
                >
                  当前还没有发现资源，请先注册 manifest。
                </div>
              </div>
            </UCard>

            <div class="grid gap-4">
              <UCard>
                <template #header>
                  <div class="space-y-1">
                    <h3 class="text-base font-semibold text-slate-900">
                      Scope 与 Capability
                    </h3>
                    <p class="text-sm text-slate-600">
                      从 manifest 中读取 app 自报的业务能力边界。
                    </p>
                  </div>
                </template>

                <div class="space-y-4">
                  <div>
                    <p class="text-sm font-medium text-slate-900">
                      supportedScopes
                    </p>
                    <div class="mt-2 flex flex-wrap gap-2">
                      <UBadge
                        v-for="scope in supportedScopes"
                        :key="scope"
                        color="success"
                        variant="soft"
                      >
                        {{ scope }}
                      </UBadge>
                      <span
                        v-if="supportedScopes.length === 0"
                        class="text-sm text-slate-500"
                      >未声明 supportedScopes</span>
                    </div>
                  </div>

                  <div>
                    <p class="text-sm font-medium text-slate-900">
                      capabilitiesRequired
                    </p>
                    <div class="mt-2 flex flex-wrap gap-2">
                      <UBadge
                        v-for="capability in requiredCapabilities"
                        :key="capability"
                        color="warning"
                        variant="soft"
                      >
                        {{ capability }}
                      </UBadge>
                      <span
                        v-if="requiredCapabilities.length === 0"
                        class="text-sm text-slate-500"
                      >未声明 capabilitiesRequired</span>
                    </div>
                  </div>

                  <div>
                    <p class="text-sm font-medium text-slate-900">
                      recommendedRoles
                    </p>
                    <div class="mt-2 grid gap-2">
                      <div
                        v-for="role in suggestedRoles"
                        :key="role.code"
                        class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
                      >
                        <p class="text-sm font-semibold text-slate-900">
                          {{ role.name }}
                        </p>
                        <p class="text-xs text-slate-500">
                          {{ role.code }}
                        </p>
                        <p class="mt-1 text-sm text-slate-600">
                          {{ role.description || '未设置描述' }}
                        </p>
                      </div>
                      <div
                        v-if="suggestedRoles.length === 0"
                        class="text-sm text-slate-500"
                      >
                        manifest 未声明 recommendedRoles
                      </div>
                    </div>
                  </div>
                </div>
              </UCard>

              <UCard>
                <template #header>
                  <div class="space-y-1">
                    <h3 class="text-base font-semibold text-slate-900">
                      从 GitLab 导入新 manifest 版本
                    </h3>
                    <p class="text-sm text-slate-600">
                      选择 Release 或手工输入 version，读取仓库中的 app.manifest.json 并注册。
                    </p>
                  </div>
                </template>

                <div class="space-y-4">
                  <div class="flex flex-wrap gap-2">
                    <UButton
                      color="primary"
                      variant="soft"
                      icon="i-lucide-list"
                      :disabled="!application?.repoUrl"
                      :loading="releasesPending"
                      @click="loadReleasesForImport"
                    >
                      拉取 Release 列表
                    </UButton>
                  </div>

                  <div
                    v-if="releasesLoaded"
                    class="grid gap-2 md:grid-cols-2"
                  >
                    <button
                      v-for="release in releases"
                      :key="release.tagName"
                      type="button"
                      class="rounded-2xl border px-3 py-3 text-left transition"
                      :class="gitlabImportForm.version === release.tagName ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white hover:border-sky-200'"
                      @click="pickRelease(release)"
                    >
                      <p class="text-sm font-semibold text-slate-900">
                        {{ release.name }}
                      </p>
                      <p class="text-xs text-slate-500">
                        tag: {{ release.tagName }} · {{ formatDate(release.releasedAt || release.createdAt) }}
                      </p>
                    </button>
                    <div
                      v-if="releases.length === 0"
                      class="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 md:col-span-2"
                    >
                      该仓库暂未发布任何 Release。
                    </div>
                  </div>

                  <form
                    class="space-y-3"
                    @submit.prevent="importManifestFromGitLab"
                  >
                    <div class="grid gap-3 md:grid-cols-2">
                      <label class="tenant-field">
                        <span class="tenant-field__label">release / tag</span>
                        <UInput
                          v-model="gitlabImportForm.version"
                          placeholder="例如 v0.0.1 或 0.0.1"
                        />
                      </label>

                      <label class="tenant-field">
                        <span class="tenant-field__label">ref / tag</span>
                        <UInput
                          v-model="gitlabImportForm.ref"
                          placeholder="可选，默认使用 release / tag"
                        />
                      </label>

                      <label class="tenant-field md:col-span-2">
                        <span class="tenant-field__label">manifestPath</span>
                        <UInput
                          v-model="gitlabImportForm.manifestPath"
                          placeholder="app.manifest.json"
                        />
                      </label>
                    </div>

                    <UButton
                      color="primary"
                      icon="i-simple-icons-gitlab"
                      :disabled="!application?.repoUrl"
                      :loading="gitlabImportPending"
                      type="submit"
                    >
                      从 GitLab 导入并注册
                    </UButton>
                  </form>

                  <div class="border-t border-slate-200 pt-4">
                    <form
                      class="space-y-4"
                      @submit.prevent="submitManifestForm"
                    >
                      <label class="tenant-field">
                        <span class="tenant-field__label">version</span>
                        <UInput
                          v-model="manifestForm.version"
                          placeholder="例如 1.0.0"
                        />
                      </label>

                      <label class="tenant-field">
                        <span class="tenant-field__label">manifestJson</span>
                        <UTextarea
                          v-model="manifestForm.manifestJson"
                          :rows="14"
                          placeholder="输入完整 manifest JSON"
                        />
                      </label>

                      <UButton
                        color="primary"
                        variant="soft"
                        :loading="manifestPending"
                        type="submit"
                      >
                        手工注册 manifest
                      </UButton>
                    </form>
                  </div>
                </div>
              </UCard>
            </div>
          </div>
        </div>

        <div
          v-else-if="activeTab === 'roles'"
          class="space-y-4"
        >
          <div class="grid gap-3 md:grid-cols-4">
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                Platform Roles
              </p>
              <p class="mt-2 text-lg font-semibold text-slate-900">
                {{ appRoles.length }}
              </p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 md:col-span-3">
              <p class="text-sm text-slate-600">
                这里展示当前应用在平台侧已经铺好的应用权限角色，可被企业角色组合引用。
              </p>
            </div>
          </div>

          <div class="grid gap-3">
            <div
              v-for="role in appRoles"
              :key="role.id"
              class="rounded-2xl border border-slate-200 bg-white px-4 py-3"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="space-y-1">
                  <p class="text-sm font-semibold text-slate-900">
                    {{ role.roleName }}
                  </p>
                  <p class="text-xs text-slate-500">
                    {{ role.roleCode }}
                  </p>
                  <p class="text-sm text-slate-600">
                    {{ role.description || '未设置描述' }}
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <UBadge
                    color="neutral"
                    variant="soft"
                  >
                    {{ role.roleType }}
                  </UBadge>
                  <UBadge
                    :color="role.status === 'active' ? 'success' : role.status === 'suspended' ? 'warning' : 'neutral'"
                    variant="soft"
                  >
                    {{ role.status }}
                  </UBadge>
                </div>
              </div>
            </div>

            <div
              v-if="!rolesPending && appRoles.length === 0"
              class="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500"
            >
              当前应用还没有平台角色铺底。
            </div>
          </div>
        </div>

        <div
          v-else-if="activeTab === 'templates'"
          class="space-y-4"
        >
          <div class="grid gap-3 md:grid-cols-4">
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                Templates
              </p>
              <p class="mt-2 text-lg font-semibold text-slate-900">
                {{ appTemplates.length }}
              </p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 md:col-span-3">
              <p class="text-sm text-slate-600">
                模板中心承接该应用的应用权限角色组合，为后续企业角色继承提供可复用能力。
              </p>
            </div>
          </div>

          <div class="grid gap-3">
            <div
              v-for="template in appTemplates"
              :key="template.id"
              class="rounded-2xl border border-slate-200 bg-white px-4 py-3"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="space-y-1">
                  <p class="text-sm font-semibold text-slate-900">
                    {{ template.templateName }}
                  </p>
                  <p class="text-xs text-slate-500">
                    {{ template.templateCode }} · {{ template.templateType }}
                  </p>
                  <p class="text-sm text-slate-600">
                    {{ template.description || '未设置描述' }}
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <UBadge
                    color="neutral"
                    variant="soft"
                  >
                    {{ template.roleCount }} roles
                  </UBadge>
                  <UBadge
                    :color="template.status === 'active' ? 'success' : template.status === 'suspended' ? 'warning' : 'neutral'"
                    variant="soft"
                  >
                    {{ template.status }}
                  </UBadge>
                </div>
              </div>
            </div>

            <div
              v-if="!templatesPending && appTemplates.length === 0"
              class="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500"
            >
              当前应用还没有模板中心记录。
            </div>
          </div>
        </div>

        <div
          v-else
          class="space-y-4"
        >
          <div class="grid gap-3 md:grid-cols-4">
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                Releases
              </p>
              <p class="mt-2 text-lg font-semibold text-slate-900">
                {{ appReleases.length }}
              </p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                Latest Released
              </p>
              <p class="mt-2 text-lg font-semibold text-slate-900">
                {{ latestReleasedVersion?.releaseVersion || '—' }}
              </p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                Pending
              </p>
              <p class="mt-2 text-lg font-semibold text-slate-900">
                {{ unreleasedCount }}
              </p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                Warnings
              </p>
              <p class="mt-2 text-lg font-semibold text-slate-900">
                {{ releaseWarningCount }}
              </p>
            </div>
          </div>

          <UCard>
            <template #header>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="space-y-1">
                  <h3 class="text-base font-semibold text-slate-900">
                    应用版本
                  </h3>
                  <p class="text-sm text-slate-600">
                    每个版本对应一个 release 与 manifest；权限覆盖缺口只提示，不阻断发布。
                  </p>
                </div>
                <UButton
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-refresh-cw"
                  :loading="appReleasesPending"
                  :disabled="!application?.appCode"
                  @click="application?.appCode && loadAppReleases(application.appCode)"
                >
                  刷新版本
                </UButton>
              </div>
            </template>

            <div class="grid gap-3">
              <div
                v-for="release in appReleases"
                :key="release.id"
                class="rounded-2xl border border-slate-200 bg-white px-4 py-3"
              >
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0 space-y-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="text-sm font-semibold text-slate-900">
                        {{ release.releaseVersion }}
                      </p>
                      <UBadge
                        :color="releaseStatusColor(release.status)"
                        variant="soft"
                      >
                        {{ release.status }}
                      </UBadge>
                      <UBadge
                        v-if="release.isLatestReleased"
                        color="success"
                        variant="soft"
                      >
                        latest
                      </UBadge>
                      <UBadge
                        v-if="release.missingGrantActionCount > 0"
                        color="warning"
                        variant="soft"
                      >
                        {{ release.missingGrantActionCount }} uncovered
                      </UBadge>
                    </div>

                    <p class="text-xs text-slate-500">
                      tag: {{ release.sourceTag }} · commit: {{ shortHash(release.sourceCommitSha) }}
                    </p>
                    <p class="text-xs text-slate-500">
                      manifest #{{ release.manifestSeq }} · {{ shortHash(release.manifestHash) }}
                    </p>

                    <div class="flex flex-wrap gap-2 text-xs text-slate-600">
                      <span>{{ release.resourceCount }} resources</span>
                      <span>{{ release.actionCount }} actions</span>
                      <span>created {{ formatDate(release.createdAt) }}</span>
                      <span v-if="release.releasedAt">released {{ formatDate(release.releasedAt) }}</span>
                    </div>

                    <div
                      v-if="release.missingActions.length"
                      class="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"
                    >
                      <p class="text-xs font-medium text-amber-900">
                        未被应用权限角色覆盖的授权动作
                      </p>
                      <div class="mt-2 flex flex-wrap gap-1.5">
                        <UBadge
                          v-for="action in release.missingActions"
                          :key="action"
                          color="warning"
                          variant="soft"
                        >
                          {{ action }}
                        </UBadge>
                      </div>
                    </div>
                  </div>

                  <div class="flex flex-wrap justify-end gap-2">
                    <UButton
                      v-if="release.status !== 'ready' && release.status !== 'released' && release.status !== 'deprecated'"
                      color="primary"
                      variant="soft"
                      :loading="releaseActionPendingId === release.id"
                      @click="updateReleaseStatus(release, 'ready')"
                    >
                      标记 ready
                    </UButton>
                    <UButton
                      v-if="release.status !== 'released' && release.status !== 'deprecated'"
                      color="success"
                      variant="soft"
                      :loading="releaseActionPendingId === release.id"
                      @click="updateReleaseStatus(release, 'released')"
                    >
                      发布
                    </UButton>
                    <UButton
                      v-if="release.status !== 'permissions_pending' && release.status !== 'released' && release.status !== 'deprecated'"
                      color="warning"
                      variant="soft"
                      :loading="releaseActionPendingId === release.id"
                      @click="updateReleaseStatus(release, 'permissions_pending')"
                    >
                      待权限
                    </UButton>
                    <UButton
                      v-if="release.status !== 'deprecated'"
                      color="neutral"
                      variant="soft"
                      :loading="releaseActionPendingId === release.id"
                      @click="updateReleaseStatus(release, 'deprecated')"
                    >
                      废弃
                    </UButton>
                  </div>
                </div>
              </div>

              <div
                v-if="!appReleasesPending && appReleases.length === 0"
                class="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500"
              >
                当前应用还没有 release 版本。请从 GitLab release 导入 manifest，或手工注册 manifest。
              </div>
            </div>
          </UCard>

          <UCard>
            <template #header>
              <div class="space-y-1">
                <h3 class="text-base font-semibold text-slate-900">
                  Manifest 历史
                </h3>
                <p class="text-sm text-slate-600">
                  manifest_seq 独立于 release 版本，资源内容变化时递增。
                </p>
              </div>
            </template>

            <div class="grid gap-3">
              <div
                v-for="manifest in manifests"
                :key="manifest.id"
                class="rounded-2xl border border-slate-200 bg-white px-4 py-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="space-y-1">
                    <p class="text-sm font-semibold text-slate-900">
                      manifest #{{ manifest.manifestSeq }}
                    </p>
                    <p class="text-xs text-slate-500">
                      {{ manifest.manifestHash }}
                    </p>
                    <p class="text-xs text-slate-500">
                      {{ formatDate(manifest.createdAt) }}
                    </p>
                  </div>
                  <UBadge
                    :color="manifest.status === 'active' ? 'success' : manifest.status === 'suspended' ? 'warning' : 'neutral'"
                    variant="soft"
                  >
                    {{ manifest.status }}
                  </UBadge>
                </div>
              </div>

              <div
                v-if="!manifestsPending && manifests.length === 0"
                class="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500"
              >
                当前应用还没有 manifest 历史。
              </div>
            </div>
          </UCard>
        </div>
      </UCard>
    </template>
  </UDashboardPanel>
</template>
