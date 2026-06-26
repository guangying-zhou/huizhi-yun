<script setup lang="ts">
import { ref, watch, computed } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  commitId: { type: Number, required: true }
})

const emit = defineEmits(['update:modelValue'])

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

const { apiBase } = await useApiBase()

interface CommitDetail {
  id: number
  repoCatalogId: number
  repoCatalogName: string
  sourceType: string
  repoKey: string
  revision: string
  authorName: string
  authorEmail: string
  committedAt: string
  title: string
  message: string
  filesAdded: number
  filesDeleted: number
  filesModified: number
  linesAdded: number
  linesDeleted: number
  linesModified: number
  filesChanged: number
  bannedDirectories: string[]
  bannedDirectoryFiles: number
  directoriesBanned: number
  filesUnexpected: number
  filesDuplicated: number
  binaryFilesAdded: number
  binaryFilesDeleted: number
  binaryFilesModified: number
  binaryFilesDuplicated: number
  unexceptedFilesBytes: number
  duplicateFilesBytes: number
  bytesAdded: number
  binaryBytesAdded: number
}

interface CommitFile {
  id: number
  repoCommitId: number
  filePath: string
  changeType: string
  linesAdded: number
  linesDeleted: number
  linesModified: number
  bytesBefore: number
  bytesAfter: number
  canLineCount: boolean
  fileType: string
  isDuplicate: boolean
}

const commit = ref<CommitDetail | null>(null)
const files = ref<CommitFile[]>([])
const loading = ref(false)
const filePage = ref(1)
const filePageSize = 50

const paginatedFiles = computed(() => {
  const start = (filePage.value - 1) * filePageSize
  return files.value.slice(start, start + filePageSize)
})

const totalFilePages = computed(() => Math.ceil(files.value.length / filePageSize))

async function loadData() {
  if (!props.commitId) return
  loading.value = true
  try {
    const [commitRes, filesRes] = await Promise.all([
      $fetch<CommitDetail>(`${apiBase}/commits/${props.commitId}`),
      $fetch<{ data: CommitFile[] }>(`${apiBase}/commits/${props.commitId}/files`)
    ])
    commit.value = commitRes
    console.log(commit.value)
    files.value = filesRes.data
  } catch (error: unknown) {
    useToast().add({ title: '加载失败', description: (error as Error).message, color: 'error' })
  } finally {
    loading.value = false
    filePage.value = 1 // Reset to first page when loading new data
  }
}

watch(() => props.modelValue, (val) => {
  if (val && props.commitId) {
    loadData()
  }
}, { immediate: true })

const getChangeTypeColor = (type: string): 'success' | 'primary' | 'error' | 'warning' | 'neutral' => {
  const map: Record<string, 'success' | 'primary' | 'error' | 'warning' | 'neutral'> = {
    A: 'success',
    M: 'primary',
    D: 'error',
    R: 'warning'
  }
  return map[type] || 'neutral'
}

const formatBytes = (bytes: number) => {
  if (bytes === null || bytes === undefined) return '0 B'
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const getRowClass = (row: CommitFile) => {
  if (row.fileType === 'banned') return 'bg-red-50 dark:bg-red-900/20'
  if (row.isDuplicate) return 'bg-warning-50 dark:bg-warning-500/20'
  return ''
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="提交详情"
    :description="commit ? 'ID: ' + commit.id + ' - ' + new Date(commit.committedAt).toLocaleString() + ' - ' + commit.repoCatalogName + ' - Rev: ' + commit.revision.substring(0, 8) + ' - By: ' + commit.authorName : undefined"
    class="sm:max-w-6xl"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <div
          v-if="loading"
          class="p-8 flex justify-center"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="animate-spin w-8 h-8 text-gray-400"
          />
        </div>

        <div
          v-else-if="commit"
          class="divide-y divide-gray-200 dark:divide-gray-800"
        >
          <!-- Commit Info -->
          <div class="p-4 space-y-4">
            <div
              v-if="commit.message"
              class="bg-gray-50 dark:bg-gray-800/50 rounded-lg py-2 px-4 text-sm font-mono whitespace-pre-wrap"
            >
              {{ '[提交注释] ' + commit.message }}
            </div>
            <div
              v-else
              class="bg-gray-50 dark:bg-gray-800/50 rounded-lg py-2 px-4 text-warning-500 font-bold font-mono whitespace-pre-wrap"
            >
              {{ '[提交注释] --- 未填写 ---' }}
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-6 gap-4 text-sm">
              <div>
                <span class="text-gray-500">变更文件总数</span>
                <div class="font-medium">
                  {{ commit.filesChanged + commit.bannedDirectoryFiles || 0 }}
                </div>
              </div>
              <div>
                <span class="text-gray-500">有效新增</span>
                <div class="font-medium text-success-600">
                  {{ commit.filesAdded }}
                </div>
              </div>
              <div>
                <span class="text-gray-500">删除文件</span>
                <div class="font-medium text-error-600">
                  {{ commit.filesDeleted + commit.binaryFilesDeleted }}
                </div>
              </div>
              <div>
                <span class="text-gray-500">修改文件</span>
                <div class="font-medium text-primary-600">
                  {{ commit.filesModified + commit.binaryFilesModified }}
                </div>
              </div>
              <div>
                <span class="text-gray-500">重复文件</span>
                <div class="font-medium text-warning-600">
                  {{ commit.filesDuplicated + commit.binaryFilesDuplicated }}
                </div>
              </div>
              <div>
                <span class="text-gray-500">异常文件</span>
                <div class="font-medium text-warning-600">
                  {{ commit.filesUnexpected + commit.bannedDirectoryFiles }}
                </div>
              </div>
              <div>
                <span class="text-gray-500">新增行数</span>
                <div class="font-medium text-success-600">
                  +{{ commit.linesAdded }}
                </div>
              </div>
              <div>
                <span class="text-gray-500">删除行数</span>
                <div class="font-medium text-error-600">
                  {{ commit.linesDeleted }}
                </div>
              </div>

              <div>
                <span class="text-gray-500">修改行数</span>
                <div class="font-medium text-primary-600">
                  {{ commit.linesModified }}
                </div>
              </div>

              <div>
                <span class="text-gray-500">有效新增(代码+二进制)</span>
                <div class="font-medium text-success-600">
                  {{ formatBytes(commit.bytesAdded) + ' + ' + formatBytes(commit.binaryBytesAdded) }}
                </div>
              </div>
              <div>
                <span class="text-gray-500">重复文件大小</span>
                <div class="font-medium text-warning-600">
                  {{ formatBytes(commit.duplicateFilesBytes) }}
                </div>
              </div>

              <div>
                <span class="text-gray-500">异常文件大小</span>
                <div class="font-medium text-warning-600">
                  {{ formatBytes(commit.unexceptedFilesBytes) }}
                </div>
              </div>
            </div>

            <!-- Banned Directory Warning -->
            <UAlert
              v-if="commit.bannedDirectories && commit.bannedDirectoryFiles > 0"
              icon="i-lucide-alert-triangle"
              color="error"
              variant="soft"
              :title="`本次提交包含${commit.bannedDirectories.length}个禁止提交的目录,内有${commit.bannedDirectoryFiles}个文件`"
              :description="`目录: ${commit.bannedDirectories.join(', ')}`"
            />
          </div>

          <!-- File List -->
          <div class="max-h-[50vh] overflow-y-auto">
            <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead class="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
                <tr>
                  <th
                    scope="col"
                    class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16 text-center"
                  >
                    类型
                  </th>
                  <th
                    scope="col"
                    class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    文件路径
                  </th>
                  <th
                    scope="col"
                    class="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-24"
                  >
                    大小
                  </th>
                  <th
                    scope="col"
                    class="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-24"
                  >
                    行数
                  </th>
                </tr>
              </thead>
              <tbody class="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
                <tr
                  v-for="file in paginatedFiles"
                  :key="file.id"
                  :class="getRowClass(file)"
                >
                  <td class="px-3 py-2 whitespace-nowrap text-center">
                    <UBadge
                      :color="getChangeTypeColor(file.changeType)"
                      size="xs"
                      variant="subtle"
                    >
                      {{ file.changeType }}
                    </UBadge>
                  </td>
                  <td class="px-3 py-2 text-sm font-mono break-all">
                    <div class="flex items-center gap-2">
                      <span>{{ file.filePath }}</span>
                      <UTooltip
                        v-if="file.fileType === 'banned'"
                        text="禁止的文件类型"
                      >
                        <UIcon
                          name="i-lucide-ban"
                          class="w-4 h-4 text-red-500"
                        />
                      </UTooltip>
                      <UTooltip
                        v-if="file.isDuplicate"
                        text="重复文件"
                      >
                        <UIcon
                          name="i-lucide-copy"
                          class="w-4 h-4 text-orange-500"
                        />
                      </UTooltip>
                    </div>
                  </td>
                  <td class="px-3 py-2 whitespace-nowrap text-sm text-gray-500 text-right">
                    {{ formatBytes(file.bytesAfter || file.bytesBefore || 0) }}
                  </td>
                  <td class="px-3 py-2 whitespace-nowrap text-sm text-gray-500 text-right">
                    <span v-if="file.canLineCount">
                      <span
                        v-if="file.linesAdded"
                        class="text-success-600"
                      >+{{ file.linesAdded
                      }}</span>
                      <span
                        v-if="file.linesDeleted"
                        class="text-error-600 ml-1"
                      >-{{ file.linesDeleted
                      }}</span>
                    </span>
                    <span v-else>-</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div
            v-if="files.length > filePageSize"
            class="flex justify-between items-center px-4 py-2 border-t border-gray-200 dark:border-gray-800"
          >
            <span class="text-xs text-gray-500">
              显示 {{ ((filePage - 1) * filePageSize) + 1 }} - {{ Math.min(filePage * filePageSize, files.length) }} 条，共
              {{ files.length }} 个文件
            </span>
            <UPagination
              v-model:page="filePage"
              :total="files.length"
              :items-per-page="filePageSize"
              :sibling-count="1"
              size="xs"
              show-edges
            />
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
