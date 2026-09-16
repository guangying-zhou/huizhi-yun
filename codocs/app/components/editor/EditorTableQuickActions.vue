<script setup lang="ts">
import type { EditorTableQuickAction, TableQuickActionsState } from './useEditorTableUi'

defineProps<{
  state: TableQuickActionsState
  readonly: boolean
  viewMode: 'edit' | 'source'
  canMerge: boolean
  canSplit: boolean
}>()

const emit = defineEmits<{
  action: [action: EditorTableQuickAction]
}>()
</script>

<template>
  <div v-if="state.visible && !readonly && viewMode !== 'source'" class="table-quick-actions absolute inset-0 pointer-events-none z-40">
    <div class="pointer-events-auto absolute table-quick-actions-group" :style="{ top: `${state.rowTop}px`, left: `${state.rowLeft}px` }">
      <button
        type="button"
        class="table-quick-action-btn"
        title="上方插入行"
        @mousedown.prevent.stop="emit('action', 'row-before')"
      >
        <UIcon name="i-lucide-plus" class="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        class="table-quick-action-btn table-quick-action-btn-danger"
        title="删除当前行"
        @mousedown.prevent.stop="emit('action', 'row-delete')"
      >
        <UIcon name="i-lucide-minus" class="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        class="table-quick-action-btn"
        title="下方插入行"
        @mousedown.prevent.stop="emit('action', 'row-after')"
      >
        <UIcon name="i-lucide-plus" class="h-3.5 w-3.5" />
      </button>
    </div>

    <div class="pointer-events-auto absolute table-quick-actions-group table-quick-actions-group-horizontal" :style="{ top: `${state.colTop}px`, left: `${state.colLeft}px` }">
      <button
        type="button"
        class="table-quick-action-btn"
        title="左侧插入列"
        @mousedown.prevent.stop="emit('action', 'column-before')"
      >
        <UIcon name="i-lucide-plus" class="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        class="table-quick-action-btn table-quick-action-btn-danger"
        title="删除当前列"
        @mousedown.prevent.stop="emit('action', 'column-delete')"
      >
        <UIcon name="i-lucide-minus" class="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        class="table-quick-action-btn"
        title="右侧插入列"
        @mousedown.prevent.stop="emit('action', 'column-after')"
      >
        <UIcon name="i-lucide-plus" class="h-3.5 w-3.5" />
      </button>
    </div>

    <div class="pointer-events-auto absolute table-quick-actions-group table-quick-actions-group-horizontal" :style="{ top: `${state.toolbarTop}px`, left: `${state.toolbarLeft}px` }">
      <button
        type="button"
        class="table-quick-action-btn"
        title="切换当前行为表头"
        @mousedown.prevent.stop="emit('action', 'header-toggle')"
      >
        <UIcon name="i-lucide-heading-1" class="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        class="table-quick-action-btn table-quick-action-btn-danger"
        title="删除整个表格"
        @mousedown.prevent.stop="emit('action', 'table-delete')"
      >
        <UIcon name="i-lucide-trash-2" class="h-3.5 w-3.5" />
      </button>
    </div>

    <div v-show="state.selectionVisible" class="pointer-events-auto absolute table-quick-actions-group table-quick-actions-group-horizontal" :style="{ top: `${state.selectionTop}px`, left: `${state.selectionLeft}px` }">
      <button
        type="button"
        class="table-quick-action-btn"
        :disabled="!canMerge"
        title="合并单元格（先框选多个单元格）"
        @mousedown.prevent.stop="emit('action', 'merge')"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M3 7V5a2 2 0 0 1 2-2h2" />
          <path d="M17 3h2a2 2 0 0 1 2 2v2" />
          <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
          <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
          <rect
            x="7"
            y="7"
            width="10"
            height="10"
            rx="1"
          />
        </svg>
      </button>
      <button
        type="button"
        class="table-quick-action-btn"
        :disabled="!canSplit"
        title="拆分单元格"
        @mousedown.prevent.stop="emit('action', 'split')"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M8 19H5a2 2 0 0 1-2-2v-2" />
          <path d="M8 5H5a2 2 0 0 0-2 2v2" />
          <path d="M16 19h3a2 2 0 0 1 2-2v-2" />
          <path d="M16 5h3a2 2 0 0 1 2 2v2" />
          <path d="M12 4v16" />
        </svg>
      </button>
    </div>
  </div>
</template>
