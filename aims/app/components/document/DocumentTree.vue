<script setup lang="ts">
export interface DocumentNode {
  id: number
  uuid?: string
  title: string
  type: 'folder' | 'document'
  parentId: number | null
  category?: string
  codocsUuid?: string | null
  updatedAt?: string
  virtual?: boolean
  children?: DocumentNode[]
}

const props = defineProps<{
  documents: DocumentNode[]
  loading: boolean
  level?: number
  readonly?: boolean
}>()

const emit = defineEmits<{
  'create-folder': [parentId: number | null]
  'create-doc': [parentId: number | null]
  'delete': [id: number]
  'click-doc': [doc: DocumentNode]
  'access-control': [id: number]
}>()

const currentLevel = computed(() => props.level ?? 0)
const isReadonly = computed(() => Boolean(props.readonly))

const expandedFolders = ref<Set<number>>(new Set())

function toggleFolder(id: number) {
  if (expandedFolders.value.has(id)) {
    expandedFolders.value.delete(id)
  } else {
    expandedFolders.value.add(id)
  }
}

function handleClick(doc: DocumentNode) {
  if (doc.type === 'folder') {
    toggleFolder(doc.id)
  } else {
    emit('click-doc', doc)
  }
}

function formatDate(date: string | undefined) {
  if (!date) return '-'
  return date.slice(0, 16).replace('T', ' ')
}
</script>

<template>
  <div v-if="loading" class="flex justify-center py-8">
    <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-muted" />
  </div>

  <div v-else-if="documents.length === 0 && currentLevel === 0" class="text-center py-8 text-sm text-muted">
    暂无文档
  </div>

  <div v-else class="space-y-0.5">
    <div
      v-for="doc in documents"
      :key="doc.id"
    >
      <div
        class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-elevated cursor-pointer select-none group"
        :style="{ paddingLeft: `${currentLevel * 1.5 + 0.5}rem` }"
        @click="handleClick(doc)"
      >
        <!-- Expand/collapse for folders -->
        <UIcon
          v-if="doc.type === 'folder'"
          :name="expandedFolders.has(doc.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="w-4 h-4 text-muted shrink-0"
        />
        <div v-else class="w-4 shrink-0" />

        <!-- Icon -->
        <UIcon
          :name="doc.type === 'folder' ? 'i-lucide-folder' : 'i-lucide-file-text'"
          :class="['w-4 h-4 shrink-0', doc.type === 'folder' ? 'text-warning' : 'text-info']"
        />

        <!-- Title -->
        <span class="text-sm truncate flex-1 min-w-0">{{ doc.title }}</span>

        <!-- Category -->
        <span v-if="doc.category" class="text-xs text-muted shrink-0 w-16 text-right">
          {{ doc.category }}
        </span>

        <!-- Updated time (固定宽度对齐) -->
        <span class="text-xs text-muted shrink-0 w-32 text-right hidden sm:inline-block">
          {{ formatDate(doc.updatedAt) }}
        </span>

        <!-- Actions (固定宽度，hover 显示) -->
        <div
          v-if="!isReadonly"
          class="flex items-center justify-end gap-0.5 shrink-0 w-24 transition-opacity"
          :class="doc.type === 'document' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
        >
          <UButton
            v-if="doc.type === 'document' && !doc.virtual"
            icon="i-lucide-shield-check"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            aria-label="访问控制"
            @click.stop="emit('access-control', doc.id)"
          />
          <UButton
            v-if="doc.type === 'folder'"
            icon="i-lucide-folder-plus"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            @click.stop="emit('create-folder', doc.id)"
          />
          <UButton
            v-if="doc.type === 'folder'"
            icon="i-lucide-file-plus"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            @click.stop="emit('create-doc', doc.id)"
          />
          <UButton
            v-if="!doc.virtual"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            square
            @click.stop="emit('delete', doc.id)"
          />
        </div>
      </div>

      <!-- Recursive children -->
      <DocumentTree
        v-if="doc.type === 'folder' && expandedFolders.has(doc.id) && doc.children?.length"
        :documents="doc.children"
        :loading="false"
        :level="currentLevel + 1"
        :readonly="isReadonly"
        @create-folder="emit('create-folder', $event)"
        @create-doc="emit('create-doc', $event)"
        @delete="emit('delete', $event)"
        @click-doc="emit('click-doc', $event)"
        @access-control="emit('access-control', $event)"
      />
    </div>
  </div>
</template>
