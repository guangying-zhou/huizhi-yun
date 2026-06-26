<script setup lang="ts">
import { formatDateTime, type ApiEnvelope } from '~/utils/opsConsole'

interface GitLabReleaseItem {
  tagName: string
  name: string
  description: string | null
  releasedAt: string | null
  createdAt: string | null
  commitSha: string | null
  upcoming: boolean
}

type GitLabReleasesResponse = ApiEnvelope<{ items: GitLabReleaseItem[] }>

interface FetchLikeError extends Error {
  data?: {
    message?: string
    statusMessage?: string
  }
}

const props = withDefaults(defineProps<{
  appCode: string
  repoUrl?: string | null
  open?: boolean
  defaultManifestPath?: string
}>(), {
  repoUrl: null,
  open: false,
  defaultManifestPath: 'app.manifest.json'
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'imported': [release: GitLabReleaseItem | null]
}>()

const toast = useToast()

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value)
})

const releases = ref<GitLabReleaseItem[]>([])
const releasesPending = ref(false)
const importPending = ref(false)
const selectedTag = ref('')
const manualVersion = ref('')
const manifestPath = ref(props.defaultManifestPath)
const q = ref('')

const repoUrlText = computed(() => props.repoUrl?.trim() || '')
const selectedRelease = computed(() => releases.value.find(item => item.tagName === selectedTag.value) || null)
const importVersion = computed(() => selectedTag.value || manualVersion.value.trim())
const canImport = computed(() => Boolean(repoUrlText.value && importVersion.value && !importPending.value))

const filteredReleases = computed(() => {
  const term = q.value.trim().toLowerCase()
  if (!term) return releases.value
  return releases.value.filter(item => [
    item.tagName,
    item.name,
    item.description,
    item.commitSha
  ].some(value => value?.toLowerCase().includes(term)))
})

watch(() => props.defaultManifestPath, (value) => {
  manifestPath.value = value || 'app.manifest.json'
})

watch(() => props.repoUrl, () => {
  releases.value = []
  selectedTag.value = ''
  manualVersion.value = ''
})

watch(isOpen, (open) => {
  if (open) {
    q.value = ''
    if (repoUrlText.value) {
      loadReleases()
    }
  }
})

function errorMessage(error: unknown, fallback: string) {
  const fetchError = error as FetchLikeError
  return fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || fallback
}

async function loadReleases() {
  if (!repoUrlText.value) {
    toast.add({ title: '缺少 GitLab 仓库 URL', description: '请先在应用信息中配置 repoUrl。', color: 'warning' })
    return
  }

  releasesPending.value = true
  try {
    const response = await $fetch(
      '/api/platform/ops/app-manifest-imports/gitlab-releases',
      { query: { repoUrl: repoUrlText.value } }
    ) as GitLabReleasesResponse
    releases.value = response.data.items
    if (!releases.value.some(item => item.tagName === selectedTag.value)) {
      selectedTag.value = ''
    }
  } catch (error) {
    releases.value = []
    selectedTag.value = ''
    toast.add({
      title: 'Release 列表获取失败',
      description: errorMessage(error, '请检查 GitLab 仓库地址与平台 GitLab token。'),
      color: 'error'
    })
  } finally {
    releasesPending.value = false
  }
}

function pickRelease(release: GitLabReleaseItem) {
  selectedTag.value = release.tagName
  manualVersion.value = ''
}

async function importSelectedRelease() {
  if (!repoUrlText.value) {
    toast.add({ title: '缺少 GitLab 仓库 URL', description: '请先在应用信息中配置 repoUrl。', color: 'warning' })
    return
  }
  if (!importVersion.value) {
    toast.add({ title: '请选择 Release 或填写版本号', color: 'warning' })
    return
  }

  importPending.value = true
  try {
    await $fetch('/api/platform/ops/app-manifest-imports', {
      method: 'POST',
      body: {
        appCode: props.appCode,
        version: importVersion.value,
        ref: selectedTag.value || importVersion.value,
        tagName: selectedTag.value || importVersion.value,
        commitSha: selectedRelease.value?.commitSha || undefined,
        manifestPath: manifestPath.value.trim() || 'app.manifest.json'
      }
    })

    toast.add({
      title: 'Release 已拉取',
      description: importVersion.value,
      color: 'success'
    })
    emit('imported', selectedRelease.value)
    isOpen.value = false
  } catch (error) {
    toast.add({
      title: '拉取失败',
      description: errorMessage(error, '请检查 GitLab release/tag 与 manifest 路径。'),
      color: 'error'
    })
  } finally {
    importPending.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="从 GitLab 拉取新版本"
    description="使用应用信息中的 GitLab 仓库 URL 获取 release/tag 列表，并注册对应 manifest。"
    :ui="{ content: 'max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="!repoUrlText"
          color="warning"
          variant="soft"
          icon="i-lucide-triangle-alert"
          title="当前应用未配置 GitLab 仓库 URL"
          description="请先到应用设置中补齐 repoUrl，再拉取新版本。"
        />

        <div class="grid gap-3 md:grid-cols-[1fr_220px]">
          <UFormField label="GitLab 仓库 URL">
            <UInput
              :model-value="repoUrlText || '未配置'"
              readonly
              class="w-full"
              icon="i-lucide-gitlab"
            />
          </UFormField>
          <UFormField label="Manifest 路径">
            <UInput
              v-model="manifestPath"
              class="w-full"
              placeholder="app.manifest.json"
              icon="i-lucide-file-json"
            />
          </UFormField>
        </div>

        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <UInput
            v-model="q"
            icon="i-lucide-search"
            placeholder="搜索 release、tag 或 commit…"
            class="w-full sm:max-w-80"
          />
          <span class="grow" />
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-cw"
            :loading="releasesPending"
            :disabled="!repoUrlText"
            @click="loadReleases"
          >
            刷新版本
          </UButton>
        </div>

        <div class="release-picker">
          <div
            v-if="releasesPending"
            class="release-state"
          >
            <UIcon
              name="i-lucide-loader-circle"
              class="size-4 animate-spin"
            />
            正在从 GitLab 获取版本…
          </div>

          <div
            v-else-if="filteredReleases.length"
            class="release-list"
          >
            <button
              v-for="release in filteredReleases"
              :key="release.tagName"
              type="button"
              class="release-option"
              :class="{ selected: selectedTag === release.tagName }"
              :aria-pressed="selectedTag === release.tagName"
              @click="pickRelease(release)"
            >
              <span class="release-option-main">
                <span class="release-title">
                  <span class="mono">{{ release.tagName }}</span>
                  <UBadge
                    v-if="release.upcoming"
                    color="warning"
                    variant="soft"
                    size="sm"
                  >
                    upcoming
                  </UBadge>
                </span>
                <span class="muted">{{ release.name || '未命名 Release' }}</span>
              </span>
              <span class="release-option-meta">
                <UIcon
                  v-if="selectedTag === release.tagName"
                  name="i-lucide-check-circle-2"
                  class="selected-icon"
                />
                <span>{{ formatDateTime(release.releasedAt || release.createdAt) }}</span>
                <span
                  v-if="release.commitSha"
                  class="mono"
                >{{ release.commitSha.slice(0, 8) }}</span>
              </span>
            </button>
          </div>

          <UEmpty
            v-else
            icon="i-lucide-tags"
            title="没有可选 Release"
            description="GitLab 仓库没有返回 release，或当前搜索条件没有匹配结果。"
            class="py-8"
          />
        </div>

        <UFormField label="手动版本号">
          <UInput
            v-model="manualVersion"
            :disabled="Boolean(selectedTag)"
            placeholder="没有 GitLab release 时，可手动输入 tag/ref"
            icon="i-lucide-tag"
            class="w-full sm:max-w-80"
          />
        </UFormField>
      </div>
    </template>

    <template #footer="{ close }">
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="importPending"
          @click="close"
        >
          取消
        </UButton>
        <UButton
          color="primary"
          icon="i-lucide-download-cloud"
          :loading="importPending"
          :disabled="!canImport"
          @click="importSelectedRelease"
        >
          拉取并注册
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.release-picker {
  min-height: 220px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  overflow: hidden;
}

.release-state {
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--fg-muted);
  font-size: 13px;
}

.release-list {
  max-height: 320px;
  overflow: auto;
}

.release-option {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 12px 14px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: var(--fg);
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease, box-shadow 120ms ease;
}

.release-option:last-child {
  border-bottom: 0;
}

.release-option:hover,
.release-option.selected {
  background: var(--brand-bg);
}

.release-option.selected {
  box-shadow: inset 4px 0 0 var(--brand), inset 0 0 0 1px color-mix(in srgb, var(--brand) 32%, transparent);
}

.release-option.selected .release-title .mono {
  color: var(--brand-fg);
  font-weight: 650;
}

.release-option-main,
.release-option-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.release-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.release-title .mono,
.release-option .muted {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.release-option-meta {
  align-items: flex-end;
  color: var(--fg-muted);
  font-size: 12px;
}

.selected-icon {
  width: 15px;
  height: 15px;
  color: var(--brand);
}

.muted {
  color: var(--fg-muted);
}

.mono {
  font-family: var(--font-mono);
}

@media (max-width: 640px) {
  .release-option {
    grid-template-columns: 1fr;
  }

  .release-option-meta {
    align-items: flex-start;
  }
}
</style>
