<script setup lang="ts">
import { ref, watch, computed } from 'vue'

import type { PropType } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  personId: { type: Number, required: true },
  username: { type: String as PropType<string | null>, required: false },
  limit: { type: Number, default: 10 },
  startDate: { type: String, default: '' },
  endDate: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

interface Commit {
  id: number
  revision: string
  message: string
  committedAt: string
  repoName: string
  sourceType: string
  authorName: string
  filesAdded: number
  filesModified: number
  filesDeleted: number
  duplicateCodeFilesCount: number
  duplicateBinaryFilesCount: number
  bannedFilesCount: number
  totalFilesChanged: number
  totalUnexpectedFiles: number
  totalLinesChanged: number
  qualityScore: number
}

const columns = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'repoName', header: '代码库' },
  { accessorKey: 'revision', header: '版本' },
  { accessorKey: 'message', header: '提交信息' },
  { accessorKey: 'totalFilesChanged', header: '文件变更' },
  { accessorKey: 'totalUnexpectedFiles', header: '异常文件' },
  { accessorKey: 'totalLinesChanged', header: '代码行数' },
  { accessorKey: 'committedAt', header: '提交时间' },
  { accessorKey: 'qualityScore', header: '提交质量' }
]

const commits = ref<Commit[]>([])
const loading = ref(false)
const page = ref(1)
const total = ref(0)
const pageSize = 15

// Get API Base URL
const { apiBase } = await useApiBase()

async function fetchCommits() {
  if (!props.personId) return
  loading.value = true
  // commits.value = [] // Keep existing data to prevent flicker
  try {
    const query: any = {
      page: page.value,
      pageSize: pageSize
    }
    if (props.startDate) query.startDate = props.startDate
    if (props.endDate) query.endDate = props.endDate

    const res = await $fetch(`${apiBase}/contributors/${props.personId}/commits`, { query })

    if (res && (res as any).data) {
      commits.value = (res as any).data
      total.value = (res as any).total || 0
    }
  } catch (err) {
    useToast().add({ title: '无法加载提交记录', description: (err as Error)?.message || String(err), color: 'error' })
  } finally {
    loading.value = false
  }
}

watch(() => open.value, (v) => {
  if (v) {
    page.value = 1
    fetchCommits()
  }
})

watch(page, () => {
  fetchCommits()
})
</script>

<template>
  <UModal
    v-model:open="open"
    title="提交记录"
    :description="username ? `${username} 的提交记录` : undefined"
    class="sm:max-w-6xl"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <UTable
          :data="commits"
          :columns="columns"
          :loading="loading"
          class="max-h-[60vh] overflow-y-auto min-h-[400px]"
        >
          <template #repoName-cell="{ row }">
            <div
              class="max-w-[200px] truncate"
              :title="row.original.repoName"
            >
              {{ row.original.repoName }}
            </div>
          </template>
          <template #revision-cell="{ row }">
            <div class="flex items-center gap-1">
              <UBadge
                size="xs"
                variant="subtle"
                color="neutral"
                class="font-mono"
              >
                {{ row.original.revision.substring(0, 7) }}
              </UBadge>
            </div>
          </template>
          <template #message-cell="{ row }">
            <div
              class="max-w-30 truncate"
              :title="row.original.message"
            >
              {{ row.original.message }}
            </div>
          </template>
          <template #committedAt-cell="{ row }">
            <span class="text-sm text-muted-500 whitespace-nowrap">{{ new
              Date(row.original.committedAt).toLocaleString() }}</span>
          </template>
          <template #qualityScore-cell="{ row }">
            <span class="text-sm text-muted-500 whitespace-nowrap">{{ Number(row.original.qualityScore).toFixed(1)
            }}%</span>
          </template>
        </UTable>

        <div class="flex justify-between items-center px-4 py-2 border-t border-gray-200 dark:border-gray-800">
          <span class="text-sm text-muted-500">
            共 {{ total }} 条记录
          </span>
          <UPagination
            v-if="total > 0"
            v-model:page="page"
            :total="total"
            :items-per-page="pageSize"
            :sibling-count="1"
            show-edges
          />
        </div>
      </div>

      <div
        v-if="!loading && commits.length === 0"
        class="p-8 text-center text-muted-500 text-sm"
      >
        暂无提交记录
      </div>
    </template>
  </UModal>
</template>
