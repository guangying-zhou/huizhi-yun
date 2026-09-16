<script setup lang="ts">
import type { GitlabFileInfo, ConflictDoc } from '~/types/account'

const props = withDefaults(defineProps<{
  conflicts?: GitlabFileInfo[]
  deletes?: Omit<GitlabFileInfo, 'doc_path'>[]
  initialPath?: string
  projectCode: string
}>(), {
  conflicts: () => [],
  deletes: () => []
})

const emit = defineEmits<{
  resolve: [docs: ConflictDoc[]]
  close: []
}>()

const isOpen = ref(true)
const loadingDiff = ref(false)

// 监听 isOpen 变化
watch(isOpen, (newVal) => {
  console.log('[ConflictModal] isOpen changed to:', newVal)
  if (!newVal) {
    emit('close')
  }
})

const handleClose = () => {
  console.log('[ConflictModal] handleClose called')
  isOpen.value = false
}

interface ConflictItem extends GitlabFileInfo {
  decision: 'gitlab' | 'oss' | null
}

interface DeleteItem extends Omit<GitlabFileInfo, 'doc_path'> {
  decision: 'delete' | 'keep' | null
}

// 只在组件创建时初始化一次，避免 watchEffect 反复重置 decision
const conflictItems = ref<ConflictItem[]>(
  (props.conflicts || []).map(c => ({ ...c, decision: null }))
)
const deleteItems = ref<DeleteItem[]>(
  (props.deletes || []).map(d => ({ ...d, decision: null }))
)

const selectedConflictIndex = ref<number | null>(null)

const unresolvedConflictCount = computed(() => {
  return conflictItems.value.filter(item => item.decision === null).length
})

const unresolvedDeleteCount = computed(() => {
  return deleteItems.value.filter(item => item.decision === null).length
})

const totalUnresolved = computed(() => {
  return unresolvedConflictCount.value + unresolvedDeleteCount.value
})

const canResolve = computed(() => {
  return totalUnresolved.value === 0
})

const fetchDiff = async (item: ConflictItem) => {
  if (item.diff) {
    console.log('[ConflictModal] Diff already cached for:', item.oss_path)
    return
  }

  loadingDiff.value = true
  try {
    console.log('[ConflictModal] Fetching diff for:', item.oss_path)
    const response = await $fetch<{ code: number, data: string }>(`/api/project-docs/diff/${props.projectCode}`, {
      query: { ossPath: item.oss_path }
    })

    if (response.code === 0) {
      item.diff = response.data
    }
  } catch (error) {
    console.error('[ConflictModal] Failed to fetch diff:', error)
  } finally {
    loadingDiff.value = false
  }
}

const selectConflict = async (index: number) => {
  selectedConflictIndex.value = index
  console.log('[ConflictModal] Selected conflict:', index)

  const item = conflictItems.value[index]
  if (item) {
    await fetchDiff(item)
  }
}

const selectedConflict = computed(() => {
  if (selectedConflictIndex.value === null) return null
  return conflictItems.value[selectedConflictIndex.value]
})

const handleResolve = () => {
  const docs: ConflictDoc[] = []

  // 处理冲突文件
  for (const item of conflictItems.value) {
    if (item.decision === 'gitlab') {
      docs.push({ oss_path: item.oss_path, use_gitlab: true })
    } else if (item.decision === 'oss') {
      docs.push({ oss_path: item.oss_path, use_gitlab: false })
    }
  }

  // 处理删除文件
  for (const item of deleteItems.value) {
    if (item.decision === 'delete') {
      docs.push({ oss_path: item.oss_path, delete: true })
    } else if (item.decision === 'keep') {
      // 保留文件：忽略 GitLab 的删除
      docs.push({ oss_path: item.oss_path, use_gitlab: false })
    }
  }

  console.log('[ConflictModal] Resolving with:', docs)
  emit('resolve', docs)
}

// 组件挂载时自动选择第一个冲突或指定的初始冲突
onMounted(async () => {
  if (props.initialPath) {
    const index = conflictItems.value.findIndex(item => item.oss_path === props.initialPath)
    if (index !== -1) {
      await selectConflict(index)
    } else if (conflictItems.value.length > 0) {
      await selectConflict(0)
    }
  } else if (conflictItems.value.length > 0) {
    await selectConflict(0)
  }
  console.log('[ConflictModal] Mounted, selected index:', selectedConflictIndex.value)
})
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="解决同步冲突"
    description="选择使用 GitLab 版本或保留 OSS 版本"
    :ui="{
      content: 'sm:max-w-6xl h-[90vh]'
    }"
  >
    <template #body>
      <div class="px-4 sm:px-6 py-4">
        <!-- Content -->
        <div class="flex gap-4 h-150">
          <!-- 调试信息 -->
          <div
            v-if="conflictItems.length === 0 && deleteItems.length === 0"
            class="flex-1 flex items-center justify-center"
          >
            <div class="text-center">
              <UIcon name="i-lucide-info" class="w-12 h-12 mb-3 mx-auto text-muted" />
              <p class="text-muted">
                没有需要处理的冲突
              </p>
              <p class="text-xs text-muted mt-2">
                conflicts: {{ props.conflicts.length }}, deletes: {{
                  props.deletes.length
                }}
              </p>
            </div>
          </div>

          <!-- 左侧：冲突列表 -->
          <div v-else class="w-80 border-r border-default pr-4 overflow-y-auto">
            <div v-if="conflictItems.length > 0" class="mb-6">
              <h4 class="text-sm font-medium mb-3 flex items-center gap-2">
                <UIcon name="i-lucide-git-merge" class="w-4 h-4 text-yellow-500" />
                <span>冲突文件 ({{ conflictItems.length }})</span>
              </h4>
              <div class="space-y-2">
                <div
                  v-for="(item, index) in conflictItems"
                  :key="item.oss_path"
                  class="p-3 rounded-lg cursor-pointer transition-colors"
                  :class="{
                    'bg-primary/10 border border-primary': selectedConflictIndex === index,
                    'hover:bg-elevated': selectedConflictIndex !== index,
                    'border border-green-500/50': item.decision === 'gitlab',
                    'border border-blue-500/50': item.decision === 'oss'
                  }"
                  @click="selectConflict(index)"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-medium truncate">
                        {{ item.doc_path }}
                      </div>
                      <div class="text-xs text-muted mt-1">
                        {{ item.gitlab_committer }} · {{ item.gitlab_commit_time }}
                      </div>
                    </div>
                    <UIcon
                      v-if="item.decision"
                      :name="item.decision === 'gitlab' ? 'i-lucide-check-circle' : 'i-lucide-circle-dot'"
                      class="w-4 h-4 shrink-0"
                      :class="{
                        'text-green-500': item.decision === 'gitlab',
                        'text-blue-500': item.decision === 'oss'
                      }"
                    />
                    <UIcon v-else name="i-lucide-alert-circle" class="w-4 h-4 text-yellow-500 shrink-0" />
                  </div>
                </div>
              </div>
            </div>

            <div v-if="deleteItems.length > 0">
              <h4 class="text-sm font-medium mb-3 flex items-center gap-2">
                <UIcon name="i-lucide-trash-2" class="w-4 h-4 text-red-500" />
                <span>已删除文件 ({{ deleteItems.length }})</span>
              </h4>
              <div class="space-y-2">
                <div
                  v-for="item in deleteItems"
                  :key="item.oss_path"
                  class="p-3 rounded-lg border transition-colors"
                  :class="{
                    'border-red-500/50': item.decision === 'delete',
                    'border-blue-500/50': item.decision === 'keep',
                    'border-default': item.decision === null
                  }"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-medium truncate">
                        {{ item.oss_path.split('/').pop() }}
                      </div>
                      <div class="text-xs text-muted mt-1">
                        在 GitLab 中已删除
                      </div>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                      <UButton
                        size="xs"
                        :color="item.decision === 'delete' ? 'error' : 'neutral'"
                        :variant="item.decision === 'delete' ? 'solid' : 'ghost'"
                        @click="item.decision = 'delete'"
                      >
                        删除
                      </UButton>
                      <UButton
                        size="xs"
                        :color="item.decision === 'keep' ? 'primary' : 'neutral'"
                        :variant="item.decision === 'keep' ? 'solid' : 'ghost'"
                        @click="item.decision = 'keep'"
                      >
                        保留
                      </UButton>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 右侧：冲突详情和决策 -->
          <div v-if="conflictItems.length > 0 || deleteItems.length > 0" class="flex-1 overflow-y-auto">
            <div v-if="selectedConflict" class="space-y-4">
              <div>
                <h4 class="text-base font-semibold mb-2">
                  {{ selectedConflict.doc_path }}
                </h4>
                <div class="flex items-center gap-4 text-sm text-muted">
                  <span>GitLab: {{ selectedConflict.gitlab_committer }}</span>
                  <span>{{ selectedConflict.gitlab_commit_time }}</span>
                </div>
              </div>

              <div class="space-y-3">
                <div
                  class="p-4 rounded-lg border-2 cursor-pointer transition-all"
                  :class="{
                    'border-green-500 bg-green-500/5': selectedConflict.decision === 'gitlab',
                    'border-default hover:border-primary/50': selectedConflict.decision !== 'gitlab'
                  }"
                  @click.stop="() => {
                    console.log('[ConflictModal] Selecting GitLab version')
                    if (selectedConflict) {
                      selectedConflict.decision = 'gitlab'
                    }
                  }"
                >
                  <div class="flex items-start justify-between mb-2">
                    <div class="flex items-center gap-2">
                      <UIcon name="i-lucide-git-branch" class="w-5 h-5 text-green-600" />
                      <span class="font-medium">使用 GitLab 版本</span>
                    </div>
                    <UIcon
                      v-if="selectedConflict.decision === 'gitlab'"
                      name="i-lucide-check-circle-2"
                      class="w-5 h-5 text-green-600"
                    />
                  </div>
                  <p class="text-sm text-muted">
                    覆盖 OSS 中的文件，使用从 GitLab 同步的最新版本
                  </p>
                </div>

                <div
                  class="p-4 rounded-lg border-2 cursor-pointer transition-all"
                  :class="{
                    'border-blue-500 bg-blue-500/5': selectedConflict.decision === 'oss',
                    'border-default hover:border-primary/50': selectedConflict.decision !== 'oss'
                  }"
                  @click.stop="() => {
                    console.log('[ConflictModal] Selecting OSS version')
                    if (selectedConflict) {
                      selectedConflict.decision = 'oss'
                    }
                  }"
                >
                  <div class="flex items-start justify-between mb-2">
                    <div class="flex items-center gap-2">
                      <UIcon name="i-lucide-cloud" class="w-5 h-5 text-blue-600" />
                      <span class="font-medium">保留 OSS 版本</span>
                    </div>
                    <UIcon
                      v-if="selectedConflict.decision === 'oss'"
                      name="i-lucide-check-circle-2"
                      class="w-5 h-5 text-blue-600"
                    />
                  </div>
                  <p class="text-sm text-muted">
                    保留 OSS 中的当前版本，丢弃 GitLab 的更新
                  </p>
                </div>
              </div>

              <div v-if="selectedConflict.diff || loadingDiff" class="mt-4">
                <h5 class="text-sm font-medium mb-2">
                  差异对比
                </h5>
                <div
                  v-if="loadingDiff"
                  class="bg-elevated rounded-lg p-8 flex flex-col items-center justify-center border border-default border-dashed"
                >
                  <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-primary mb-2" />
                  <p class="text-xs text-muted">
                    正在从 OSS 读取差异文件...
                  </p>
                </div>
                <div v-else class="bg-elevated rounded-lg p-4 font-mono text-xs overflow-x-auto border border-default">
                  <pre class="whitespace-pre-wrap">{{ selectedConflict.diff }}</pre>
                </div>
              </div>
            </div>

            <div v-else class="flex items-center justify-center h-full text-muted">
              <div class="text-center">
                <UIcon name="i-lucide-mouse-pointer-click" class="w-12 h-12 mb-3 mx-auto" />
                <p>选择一个冲突文件查看详情</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between w-full px-4 sm:px-6 py-4">
        <div class="text-sm text-gray-600">
          <span v-if="totalUnresolved > 0" class="text-yellow-600">
            还有 {{ totalUnresolved }} 个文件未处理
          </span>
          <span v-else class="text-green-600">所有文件已处理</span>
        </div>
        <div class="flex gap-2">
          <UButton color="neutral" variant="outline" @click="handleClose">
            取消
          </UButton>
          <UButton color="primary" :disabled="!canResolve" @click="handleResolve">
            确认解决
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
