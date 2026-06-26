<template>
  <div class="file-tree-item">
    <div
      :class="[
        'flex items-center gap-2 px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer',
        isChanged && 'bg-yellow-50 dark:bg-yellow-900/20'
      ]"
      @click="toggle"
    >
      <!-- 目录图标或展开/折叠图标 -->
      <UIcon v-if="item.isDirectory" :name="isExpanded ? 'i-lucide-folder-open' : 'i-lucide-folder'" class="text-lg" />
      <UIcon v-else name="i-lucide-file-text" class="text-lg" />
    </div>
    <div
      :class="[
        'flex items-center gap-2 px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer',
        isChanged && 'bg-yellow-50 dark:bg-yellow-900/20'
      ]"
      @click="emit('click', item)"
    >
      <!-- 文件名 -->
      <span class="flex-1">{{ item.name }}</span>

      <!-- 变更标记 -->
      <UBadge v-if="isChanged" color="warning" size="xs">
        已修改
      </UBadge>

      <!-- 文件大小 -->
      <span v-if="!item.isDirectory" class="text-xs text-gray-500">
        {{ formatSize(item.size) }}
      </span>
    </div>

    <!-- 子项（递归） -->
    <div v-if="item.isDirectory && isExpanded && item.children" class="ml-6 mt-1">
      <FileTreeItem
        v-for="child in item.children"
        :key="child.path"
        :item="child"
        :changed-paths="changedPaths"
        @click="$emit('click', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ProjectFileItem } from '~/types/index'

const props = defineProps<{
  item: ProjectFileItem
  changedPaths: Set<string>
}>()

const emit = defineEmits<{
  (e: 'click', item: ProjectFileItem): void
}>()

const isExpanded = ref(false)

const isChanged = computed(() => {
  return props.changedPaths.has(props.item.path)
})

const toggle = () => {
  if (props.item.isDirectory) {
    isExpanded.value = !isExpanded.value
  }
}

const _click = () => {
  if (props.item.isDirectory) {
    isExpanded.value = true
  }
  emit('click', props.item)
}

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}
</script>
