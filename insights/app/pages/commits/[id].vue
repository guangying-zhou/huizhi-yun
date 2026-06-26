<script setup lang="ts">
const route = useRoute()
const { apiBase } = useApiBase()
const commitId = route.params.id as string

interface CommitDetail {
  id: number
  repoName: string
  repoCatalogId: number
  authorName: string
  personId?: number
  personRealName?: string
  commitHash: string
  committedAt: string
  message?: string
  filesAdded: number
  filesDeleted: number
  filesModified: number
  linesAdded: number
  linesDeleted: number
  linesModified: number
  totalFilesChanged: number
  submissionQuality?: number
}

interface CommitFile {
  id: number
  filePath: string
  changeType: string
  linesAdded: number
  linesDeleted: number
  fileType?: string
}

const { data: commit, pending } = await useFetch<CommitDetail>(`${apiBase}/commits/${commitId}`)
const { data: files } = await useFetch<{ data: CommitFile[] }>(`${apiBase}/commits/${commitId}/files`)

const formatDate = (dateStr?: string | null) => dateStr ? dateStr.replace('T', ' ').substring(0, 19) : '-'
const getChangeTypeColor = (type: string) => type === 'A' ? 'success' : type === 'D' ? 'error' : 'warning'
const getChangeTypeLabel = (type: string) => type === 'A' ? '新增' : type === 'D' ? '删除' : '修改'
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardNavbar :title="`提交详情 #${commitId}`">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #right>
        <UButton
          v-if="commit"
          :to="`/repos/${commit.repoCatalogId}`"
          icon="i-lucide-folder"
          label="所属仓库"
          size="sm"
          variant="soft"
        />
      </template>
    </UDashboardNavbar>

    <div
      v-if="pending"
      class="flex items-center justify-center h-64"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="animate-spin text-2xl text-muted-400"
      />
    </div>

    <div
      v-else-if="commit"
      class="p-4 space-y-4"
    >
      <!-- Basic Info -->
      <UCard>
        <template #header>
          <h3 class="font-semibold">
            基本信息
          </h3>
        </template>
        <div class="grid grid-cols-4 gap-4">
          <div>
            <span class="text-sm text-muted-500">仓库</span>
            <p class="font-medium">
              {{ commit.repoName }}
            </p>
          </div>
          <div>
            <span class="text-sm text-muted-500">作者</span>
            <p class="font-medium">
              {{ commit.personRealName || commit.authorName }}
            </p>
          </div>
          <div>
            <span class="text-sm text-muted-500">提交时间</span>
            <p class="font-medium text-sm">
              {{ formatDate(commit.committedAt) }}
            </p>
          </div>
          <div>
            <span class="text-sm text-muted-500">提交哈希</span>
            <p class="font-mono text-sm">
              {{ commit.commitHash?.substring(0, 12) }}
            </p>
          </div>
        </div>
        <div
          v-if="commit.message"
          class="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded text-sm"
        >
          {{
            commit.message }}
        </div>
      </UCard>

      <!-- Stats Cards -->
      <div class="grid grid-cols-6 gap-4">
        <UCard :ui="{ body: 'p-3' }">
          <div class="text-xs text-muted-500">
            文件变更
          </div>
          <div class="text-xl font-bold">
            {{ commit.totalFilesChanged }}
          </div>
        </UCard>
        <UCard :ui="{ body: 'p-3' }">
          <div class="text-xs text-muted-500">
            新增行
          </div>
          <div class="text-xl font-bold text-success">
            +{{ commit.linesAdded }}
          </div>
        </UCard>
        <UCard :ui="{ body: 'p-3' }">
          <div class="text-xs text-muted-500">
            删除行
          </div>
          <div class="text-xl font-bold text-error">
            -{{ commit.linesDeleted }}
          </div>
        </UCard>
        <UCard :ui="{ body: 'p-3' }">
          <div class="text-xs text-muted-500">
            修改行
          </div>
          <div class="text-xl font-bold text-warning">
            {{ commit.linesModified }}
          </div>
        </UCard>
        <UCard :ui="{ body: 'p-3' }">
          <div class="text-xs text-muted-500">
            新增文件
          </div>
          <div class="text-xl font-bold">
            {{ commit.filesAdded }}
          </div>
        </UCard>
        <UCard :ui="{ body: 'p-3' }">
          <div class="text-xs text-muted-500">
            提交质量
          </div>
          <div class="text-xl font-bold">
            {{ commit.submissionQuality != null
              ? commit.submissionQuality.toFixed(0)
                + '%' : '-' }}
          </div>
        </UCard>
      </div>

      <!-- Files List -->
      <UCard v-if="files?.data?.length">
        <template #header>
          <h3 class="font-semibold">
            变更文件 ({{ files.data.length }})
          </h3>
        </template>
        <div class="max-h-96 overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 dark:bg-gray-800 sticky top-0">
              <tr>
                <th class="px-3 py-2 text-left">
                  文件路径
                </th>
                <th class="px-3 py-2 text-center">
                  类型
                </th>
                <th class="px-3 py-2 text-center">
                  +行
                </th>
                <th class="px-3 py-2 text-center">
                  -行
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="file in files.data"
                :key="file.id"
                class="border-b border-gray-100 dark:border-gray-800"
              >
                <td
                  class="px-3 py-2 font-mono text-xs truncate max-w-md"
                  :title="file.filePath"
                >
                  {{
                    file.filePath }}
                </td>
                <td class="px-3 py-2 text-center">
                  <UBadge
                    :color="getChangeTypeColor(file.changeType)"
                    size="xs"
                  >
                    {{
                      getChangeTypeLabel(file.changeType) }}
                  </UBadge>
                </td>
                <td class="px-3 py-2 text-center text-success">
                  +{{ file.linesAdded }}
                </td>
                <td class="px-3 py-2 text-center text-error">
                  -{{ file.linesDeleted }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </div>

    <div
      v-else
      class="flex items-center justify-center h-64 text-muted-500"
    >
      提交记录不存在
    </div>
  </UDashboardPanel>
</template>
