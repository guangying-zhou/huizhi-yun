<script setup lang="ts">
interface ReadonlyProjectDocument {
  id: number
  title: string
  docCategory: string | null
  isFolder: boolean
  updatedAt: string
  contentSize: number
  accessLifecycleStage: 'draft' | 'formal' | 'archived'
  accessConfidentialityLevel: 'L0' | 'L1' | 'L2' | 'L3'
  accessSummary: string
  children?: ReadonlyProjectDocument[]
}

const props = defineProps<{
  document: ReadonlyProjectDocument
  level: number
}>()

const emit = defineEmits<{
  open: [document: ReadonlyProjectDocument]
}>()

const expanded = ref(true)

const categoryLabel: Record<string, string> = {
  general: '通用',
  project_proposal: '立项书',
  requirement_spec: '需求规格',
  design_doc: '设计',
  test_doc: '测试',
  delivery_doc: '交付',
  other_word: 'Word',
  other_excel: 'Excel',
  other_powerpoint: 'PPT',
  other_pdf: 'PDF',
  other_file: '文件'
}

const levelColor: Record<string, string> = {
  L0: 'success',
  L1: 'info',
  L2: 'warning',
  L3: 'error'
}

function documentIcon() {
  if (props.document.isFolder) return 'i-lucide-folder'
  if (props.document.docCategory === 'other_excel') return 'i-lucide-file-spreadsheet'
  if (props.document.docCategory === 'other_powerpoint') return 'i-lucide-presentation'
  if (props.document.docCategory === 'other_word') return 'i-lucide-file-type'
  return 'i-lucide-file-text'
}

function formatDate(value: string) {
  if (!value) return '-'
  return value.slice(0, 16).replace('T', ' ')
}

function formatFileSize(size: number) {
  if (!size) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function handleClick() {
  if (props.document.isFolder) {
    expanded.value = !expanded.value
    return
  }
  emit('open', props.document)
}
</script>

<template>
  <div>
    <button
      class="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-elevated"
      :style="{ paddingLeft: `${level * 1.25 + 0.5}rem` }"
      @click="handleClick"
    >
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <UIcon
          v-if="document.isFolder"
          :name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="size-4 shrink-0 text-muted"
        />
        <span v-else class="w-4 shrink-0" />
        <UIcon
          :name="documentIcon()"
          :class="['size-4 shrink-0', document.isFolder ? 'text-warning' : 'text-info']"
        />
        <div class="min-w-0">
          <div class="truncate text-sm font-medium text-highlighted">
            {{ document.title }}
          </div>
          <div v-if="!document.isFolder" class="mt-0.5 flex items-center gap-2 text-xs text-muted">
            <span>{{ categoryLabel[document.docCategory || ''] || '文档' }}</span>
            <span>{{ formatFileSize(document.contentSize) }}</span>
            <span>{{ formatDate(document.updatedAt) }}</span>
          </div>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <UBadge
          v-if="!document.isFolder"
          :color="(levelColor[document.accessConfidentialityLevel] || 'neutral') as any"
          variant="subtle"
          size="xs"
        >
          {{ document.accessConfidentialityLevel }}
        </UBadge>
        <UIcon
          v-if="!document.isFolder"
          name="i-lucide-eye"
          class="size-4 text-muted"
        />
      </div>
    </button>

    <div v-if="document.isFolder && expanded && document.children?.length" class="space-y-1">
      <ProjectDocumentReadonlyNode
        v-for="child in document.children"
        :key="child.id"
        :document="child"
        :level="level + 1"
        @open="emit('open', $event)"
      />
    </div>
  </div>
</template>
