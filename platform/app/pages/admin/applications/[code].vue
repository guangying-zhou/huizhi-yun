<script setup lang="ts">
import {
  ROLE_TONE,
  appIconFallback,
  formatDateTime,
  isAppIconName,
  roleLabel,
  type ApiEnvelope,
  type OpsApplication,
  type OpsApplicationList,
  type OpsManifest,
  type OpsRelease,
  type OpsResource
} from '~/utils/opsConsole'

definePageMeta({
  layout: 'platform'
})

const route = useRoute()
const router = useRouter()
const toast = useToast()
const code = computed(() => String(route.params.code))
const importModalOpen = ref(false)

const appData = ref<ApiEnvelope<OpsApplicationList> | null>(null)
const releaseData = ref<ApiEnvelope<{ items: OpsRelease[] }> | null>(null)
const manifestData = ref<ApiEnvelope<{ items: OpsManifest[] }> | null>(null)
const resourceData = ref<ApiEnvelope<{ items: OpsResource[] }> | null>(null)

async function refreshApp() {
  appData.value = await $fetch('/api/platform/ops/applications', {
    query: {
      appCode: code.value,
      pageSize: 1
    }
  }) as ApiEnvelope<OpsApplicationList>
}

async function refreshReleases() {
  releaseData.value = await $fetch(`/api/platform/ops/applications/${code.value}/releases`) as ApiEnvelope<{ items: OpsRelease[] }>
}

async function refreshManifests() {
  manifestData.value = await $fetch(`/api/platform/ops/applications/${code.value}/manifests`) as ApiEnvelope<{ items: OpsManifest[] }>
}

async function refreshResources() {
  resourceData.value = await $fetch(`/api/platform/ops/applications/${code.value}/resources`) as ApiEnvelope<{ items: OpsResource[] }>
}

const app = computed<OpsApplication | null>(() => appData.value?.data.items[0] || null)
const releases = computed<OpsRelease[]>(() => releaseData.value?.data.items || [])
const manifests = computed<OpsManifest[]>(() => manifestData.value?.data.items || [])
const resources = computed<OpsResource[]>(() => resourceData.value?.data.items || [])

useHead({
  title: () => app.value ? `${app.value.appName} · 应用 - 汇智云平台` : '应用详情 - 汇智云平台'
})

const activeTab = computed(() => {
  const seg = route.path.split('/').filter(Boolean).pop() || ''
  if (['overview', 'releases', 'manifests', 'resources', 'settings'].includes(seg)) return seg
  return 'overview'
})

const tabItems = computed(() => [
  { value: 'overview', label: 'Overview' },
  { value: 'releases', label: 'Releases', badge: releases.value.length },
  { value: 'manifests', label: 'Manifests', badge: manifests.value.length },
  { value: 'resources', label: 'Resources', badge: resources.value.length },
  { value: 'settings', label: 'Settings' }
])

const crumbs = computed(() => [
  { label: '工作台', to: '/admin' },
  { label: '应用', to: '/admin/applications' },
  { label: app.value?.appName || code.value }
])

function statusTone(status: string) {
  return status === 'active' ? 'success' : 'warning'
}

function goTab(value: string | number) {
  navigateTo(`/admin/applications/${code.value}/${value}`)
}

function openHome() {
  if (!app.value?.homeUrl) {
    toast.add({ title: '未配置主页 URL', color: 'warning' })
    return
  }
  window.open(app.value.homeUrl, '_blank', 'noopener,noreferrer')
}

async function refreshAll(showToast = true) {
  await Promise.all([refreshApp(), refreshReleases(), refreshManifests(), refreshResources()])
  if (showToast) toast.add({ title: '应用数据已刷新', color: 'success' })
}

watch(code, () => {
  void refreshAll(false)
})

await refreshAll(false)

const moreItems = computed(() => [[
  {
    label: '刷新数据',
    icon: 'i-lucide-refresh-cw',
    onSelect: () => refreshAll()
  },
  {
    label: '编辑设置',
    icon: 'i-lucide-settings',
    onSelect: () => router.push(`/admin/applications/${code.value}/settings`)
  },
  {
    label: '查看 Release',
    icon: 'i-lucide-tags',
    onSelect: () => router.push(`/admin/applications/${code.value}/releases`)
  }
]])
</script>

<template>
  <div v-if="app">
    <UBreadcrumb
      :items="crumbs"
      class="mb-3.5"
    />

    <UCard :ui="{ body: 'p-5 sm:p-5' }">
      <div class="entity-h-row">
        <div class="entity-icon">
          <UIcon
            v-if="isAppIconName(app.icon)"
            :name="app.icon"
            class="size-5 text-muted"
          />
          <img
            v-else-if="app.icon"
            :src="app.icon"
            class="size-6 rounded object-contain"
            :alt="app.appName"
          >
          <span v-else>{{ appIconFallback(app) }}</span>
        </div>
        <div class="entity-h-main">
          <div class="entity-h-title">
            <h1>{{ app.appName }}</h1>
            <UBadge
              :color="statusTone(app.status)"
              variant="soft"
              size="sm"
            >
              <template #leading>
                <span class="size-1.5 rounded-full bg-current" />
              </template>
              {{ app.status === 'active' ? 'Active' : 'Suspended' }}
            </UBadge>
          </div>
          <div class="entity-h-meta">
            <span class="code-chip">{{ app.appCode }}</span>
            <span class="dot">·</span>
            <UBadge
              :color="ROLE_TONE[app.serviceRole]"
              variant="soft"
              size="sm"
            >
              {{ roleLabel(app.serviceRole) }}
            </UBadge>
            <span class="dot">·</span>
            <span>
              最新 <span class="mono text-highlighted">{{ app.latestReleaseVersion || '—' }}</span>
            </span>
            <span class="dot">·</span>
            <span>{{ app.subscriberCount }} 个订阅租户</span>
            <span class="dot">·</span>
            <span>创建于 {{ formatDateTime(app.createdAt) }}</span>
          </div>
        </div>
        <div class="entity-h-actions">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-external-link"
            title="打开主页"
            square
            @click="openHome"
          />
          <UDropdownMenu :items="moreItems">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-ellipsis"
              title="更多操作"
              square
            />
          </UDropdownMenu>
          <UButton
            color="primary"
            icon="i-lucide-plus"
            @click="importModalOpen = true"
          >
            从 GitLab 拉取新版本
          </UButton>
        </div>
      </div>
    </UCard>

    <UTabs
      :items="tabItems"
      :model-value="activeTab"
      variant="link"
      color="neutral"
      :content="false"
      class="mt-4"
      @update:model-value="goTab"
    />

    <NuxtPage />

    <AppGitLabReleaseImportModal
      v-model:open="importModalOpen"
      :app-code="code"
      :repo-url="app.repoUrl"
      @imported="refreshAll(false)"
    />
  </div>

  <div v-else>
    <UBreadcrumb
      :items="crumbs"
      class="mb-3.5"
    />
    <UEmpty
      icon="i-lucide-search-x"
      title="未找到该应用"
      :description="`appCode=${code} 不存在或已删除。`"
      class="py-14"
    >
      <template #actions>
        <UButton
          to="/admin/applications"
          icon="i-lucide-arrow-left"
        >
          返回应用列表
        </UButton>
      </template>
    </UEmpty>
  </div>
</template>
