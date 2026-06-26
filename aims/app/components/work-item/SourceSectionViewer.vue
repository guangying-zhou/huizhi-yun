<script setup lang="ts">
/**
 * 工作项详情页的源文档锚点懒加载卡片
 *
 * 根据 work_item_source_anchors 拉取每个锚点对应的章节原文并渲染。
 * 断链时显示降级提示，不阻塞工作项使用。
 */

interface SectionData {
  anchorId: number
  sourceDocumentUuid: string
  sourceDocumentTitle: string
  headingAnchor: string
  headingDepth: number
  sortOrder: number
  missing: boolean
  reason?: 'document_not_found' | 'anchor_not_found'
  title?: string
  markdown?: string
  updatedAt?: string
}

const props = defineProps<{
  workItemId: number
}>()

const loading = ref(false)
const sections = ref<SectionData[]>([])
const error = ref<string | null>(null)
const expanded = ref<Set<number>>(new Set())

async function load() {
  if (!props.workItemId) return
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<{ code: number, data: { sections: SectionData[] } }>(
      `/api/v1/work-items/${props.workItemId}/source-sections`
    )
    sections.value = res.data.sections
    // 默认展开第一个
    if (sections.value.length > 0 && !sections.value[0]!.missing) {
      expanded.value.add(sections.value[0]!.anchorId)
    }
  } catch (e: unknown) {
    error.value = (e as { data?: { message?: string } })?.data?.message || (e as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.workItemId, load)

function toggle(anchorId: number) {
  if (expanded.value.has(anchorId)) {
    expanded.value.delete(anchorId)
  } else {
    expanded.value.add(anchorId)
  }
}

function reasonLabel(reason?: string): string {
  if (reason === 'document_not_found') return '源文档已删除或无权访问'
  if (reason === 'anchor_not_found') return '该章节在源文档中已不存在'
  return '未知原因'
}

function formatRelative(iso?: string): string {
  if (!iso) return ''
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = Math.max(0, now - then)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}
</script>

<template>
  <div v-if="loading" class="text-sm text-muted py-4 text-center">
    加载源章节中...
  </div>

  <div v-else-if="error" class="text-sm text-error py-4 text-center">
    加载失败：{{ error }}
    <UButton size="xs" variant="link" @click="load">
      重试
    </UButton>
  </div>

  <div v-else-if="sections.length === 0" class="hidden" />

  <div v-else class="space-y-3">
    <div class="flex items-center gap-2 text-sm font-medium">
      <UIcon name="i-lucide-paperclip" class="size-4" />
      <span>源文档章节（{{ sections.length }} 个）</span>
    </div>

    <div
      v-for="section in sections"
      :key="section.anchorId"
      class="rounded-lg border border-default overflow-hidden"
    >
      <!-- 头部 -->
      <button
        type="button"
        class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-elevated"
        :class="{ 'bg-warning/5': section.missing }"
        @click="toggle(section.anchorId)"
      >
        <UIcon
          :name="expanded.has(section.anchorId) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="size-4 text-muted"
        />
        <span class="text-xs font-mono text-muted">H{{ section.headingDepth }}</span>
        <span class="flex-1 text-sm truncate">
          {{ section.sourceDocumentTitle }} · {{ section.headingAnchor }}
        </span>
        <UBadge
          v-if="section.missing"
          color="warning"
          variant="subtle"
          size="xs"
        >
          断链
        </UBadge>
      </button>

      <!-- 展开内容 -->
      <div
        v-if="expanded.has(section.anchorId)"
        class="border-t border-default px-4 py-3"
      >
        <div v-if="section.missing" class="text-sm text-warning">
          ⚠ {{ reasonLabel(section.reason) }}
          <div class="mt-1 text-xs text-muted">
            锚点：{{ section.headingAnchor }}
          </div>
        </div>
        <template v-else>
          <MarkdownContent :markdown="section.markdown || ''" />
          <div class="mt-3 flex items-center gap-2 text-xs text-muted">
            <UIcon name="i-lucide-refresh-cw" class="size-3" />
            <span>同步于 {{ formatRelative(section.updatedAt) }}</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
