<script setup lang="ts">
import { formatDateTime, type ApiEnvelope, type OpsManifest } from '~/utils/opsConsole'

definePageMeta({
  layout: 'platform'
})

const route = useRoute()
const toast = useToast()
const code = computed(() => String(route.params.code))
const data = ref<ApiEnvelope<{ items: OpsManifest[] }> | null>(null)

async function refreshManifests() {
  data.value = await $fetch(`/api/platform/ops/applications/${code.value}/manifests`) as ApiEnvelope<{ items: OpsManifest[] }>
}

watch(code, () => {
  void refreshManifests()
})

await refreshManifests()

const manifests = computed<OpsManifest[]>(() => data.value?.data.items || [])
const selectedId = ref<number | null>(null)
const selectedManifest = computed(() => {
  return manifests.value.find(item => item.id === selectedId.value) || manifests.value[0] || null
})
const selectedJson = computed(() => {
  if (!selectedManifest.value) return ''
  return JSON.stringify(selectedManifest.value.manifestJson, null, 2)
})

watch(manifests, (items) => {
  if (!selectedId.value && items[0]) {
    selectedId.value = items[0].id
  }
}, { immediate: true })

async function copyManifest() {
  if (!selectedJson.value) return

  try {
    await navigator.clipboard.writeText(selectedJson.value)
    toast.add({ title: 'Manifest 已复制', color: 'success' })
  } catch {
    toast.add({ title: '复制失败', description: '当前浏览器不允许访问剪贴板。', color: 'error' })
  }
}

function downloadManifest() {
  if (!selectedManifest.value) return

  const blob = new Blob([selectedJson.value], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${code.value}-manifest-seq-${selectedManifest.value.manifestSeq}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  toast.add({ title: 'Manifest 下载已开始', color: 'success' })
}
</script>

<template>
  <div class="mt-4 grid grid-cols-[320px_1fr] gap-4">
    <UCard
      class="self-start"
      :ui="{ body: 'p-0 sm:p-0' }"
    >
      <template #header>
        <div class="row-between">
          <h3 class="text-sm font-semibold text-highlighted">
            Manifest 历史
          </h3>
          <span class="text-xs text-muted">按 seq 倒序</span>
        </div>
      </template>

      <div>
        <button
          v-for="item in manifests"
          :key="item.id"
          type="button"
          class="block w-full border-b border-default px-3.5 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40"
          :class="item.id === selectedManifest?.id ? 'border-l-2 border-l-highlighted bg-muted/40' : 'border-l-2 border-l-transparent bg-default'"
          @click="selectedId = item.id"
        >
          <div class="row-between mb-1">
            <span class="code-chip">seq #{{ item.manifestSeq }}</span>
            <UBadge
              v-if="item.isLatest"
              color="info"
              variant="soft"
              size="sm"
            >
              latest
            </UBadge>
          </div>
          <div class="mono text-sm font-medium text-highlighted">
            {{ item.releaseVersions[0] || item.manifestHash }}
          </div>
          <div class="mt-0.5 text-xs text-muted">
            {{ formatDateTime(item.createdAt) }} · {{ item.actionCount }} actions / {{ item.resourceCount }} resources
          </div>
        </button>
      </div>
    </UCard>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <template #header>
        <div class="row-between">
          <h3 class="text-sm font-semibold text-highlighted">
            seq #{{ selectedManifest?.manifestSeq || '—' }} ·
            <span class="mono text-sm">{{ selectedManifest?.releaseVersions?.[0] || selectedManifest?.manifestHash || '—' }}</span>
          </h3>
          <div class="row gap-1.5">
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-copy"
              :disabled="!selectedManifest"
              @click="copyManifest"
            >
              复制
            </UButton>
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-download"
              :disabled="!selectedManifest"
              @click="downloadManifest"
            >
              下载
            </UButton>
          </div>
        </div>
      </template>

      <pre
        class="json-viewer rounded-none"
      >{{ selectedJson }}</pre>
    </UCard>
  </div>
</template>
