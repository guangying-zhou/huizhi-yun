<script setup lang="ts">
/**
 * 编辑器侧边栏组件
 * 整合大纲和版本历史，使用标签页切换
 */
import { ref, watch } from 'vue'
import AnnotationPanel from './annotations/AnnotationPanel.vue'

interface VersionItem {
  id: number
  versionNum: number
  createdAt: string
  editorName?: string
  contentSize?: number
}

interface AnnotationReply {
  id: number
  content: string
  author_id: string
  author_name: string
  created_at: string
}

interface AnnotationItem {
  id: number
  content: string
  selected_text: string
  author_id: string
  author_name: string
  created_at: string
  status?: string
  replies?: AnnotationReply[]
}

interface Props {
  markdown?: string
  documentId?: string
  versions?: VersionItem[]
  versionsLoading?: boolean
  showVersionHistory?: boolean
  showSharePanel?: boolean
  isProjectDoc?: boolean
  projectRepoUrl?: string
  docPath?: string
  viewMode?: 'edit' | 'source'
  annotations?: AnnotationItem[]
  currentUserId?: string
  allowShare?: boolean
  canManageShares?: boolean
  activeVersionNum?: number | null
  aiAbstract?: string
  readonly?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  markdown: '',
  documentId: '',
  versions: () => [],
  versionsLoading: false,
  showVersionHistory: false,
  showSharePanel: false,
  isProjectDoc: false,
  projectRepoUrl: '',
  docPath: '',
  viewMode: 'edit',
  annotations: () => [],
  currentUserId: '',
  allowShare: true,
  canManageShares: true,
  activeVersionNum: null,
  aiAbstract: '',
  readonly: false
})

const emit = defineEmits<{
  'close': []
  'load-versions': []
  'view-version': [versionId: number]
  'diff-version': [versionId: number]
  'share': [data: { uid: string, permission: 'read' | 'write' }]
  'remove-share': [shareId: number]
  'update-permission': [data: { shareId: number, permission: 'read' | 'write' }]
  'reply-annotation': [annotationId: number, content: string]
  'resolve-annotation': [annotationId: number]
  'delete-annotation': [annotationId: number]
  'delete-reply': [annotationId: number, replyId: number]
  'click-annotation': [annotationId: number]
  'update-abstract': [text: string]
}>()

// 当前激活的标签页
const activeTab = ref<'outline' | 'history' | 'share' | 'annotations' | 'ai'>('outline')

// 监听 showVersionHistory 的变化，自动切换到历史标签
watch(() => props.showVersionHistory, (show) => {
  if (show) {
    activeTab.value = 'history'
  }
})

// 监听 showSharePanel 的变化，自动切换到共享标签
watch(() => props.showSharePanel, (show) => {
  if (show) {
    activeTab.value = 'share'
  }
})

// 切换标签页的方法
const switchToTab = (tab: 'outline' | 'history' | 'share' | 'annotations' | 'ai') => {
  activeTab.value = tab
}

defineExpose({
  switchToTab
})

// 切换到版本历史时加载数据
const switchToHistory = () => {
  activeTab.value = 'history'
  // 如果版本数据为空且不在加载中，触发加载
  if (props.versions.length === 0 && !props.versionsLoading) {
    emit('load-versions')
  }
}

const getInitial = (value?: string | null) => {
  const text = (value || '').trim()
  return text ? text.charAt(0).toUpperCase() : '?'
}

// 格式化时间（yyyy/mm/dd hh:mm）
const formatVersionDateTime = (dateStr: string) => {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}/${m}/${d} ${h}:${min}`
}

// 格式化文件大小
const formatFileSize = (bytes?: number) => {
  if (bytes == null) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// 获取配置
const config = useRuntimeConfig()

// 构造 GitLab commits URL
const getGitLabCommitsUrl = () => {
  if (!props.projectRepoUrl || !props.docPath) {
    return '#'
  }
  // 使用环境变量中的 GitLab base URL
  const gitlabBaseUrl = (config.public.gitlabBaseUrl || 'https://gitlab.wiztek.cn').replace(/\/$/, '')
  // 从 repoUrl 提取项目路径 (例如: huizhi-yun/account)
  const repoPath = props.projectRepoUrl
    .replace(gitlabBaseUrl, '')
    .replace(/^\/+/, '')
    .replace(/\.git$/, '')
  return `${gitlabBaseUrl}/${repoPath}/-/commits/main/${props.docPath}`
}
</script>

<template>
  <div
    class="flex h-full min-h-0 max-h-full flex-col overflow-hidden border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
    style="width: 240px; min-width: 240px; max-width: 360px; height: 100%;"
  >
    <!-- 标签页头部 -->
    <div class="shrink-0 border-b border-gray-200 dark:border-gray-700">
      <div class="px-3 pt-2 pb-0">
        <div class="flex items-center w-full">
          <button
            class="flex-1 flex items-center justify-center py-1 text-sm font-medium border-b-2 transition-colors"
            :class="activeTab === 'outline'
              ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 border-primary'
              : 'text-gray-600 dark:text-gray-400 border-transparent hover:bg-gray-100 dark:hover:bg-gray-800'"
            title="大纲"
            @click="activeTab = 'outline'"
          >
            <UIcon name="i-lucide-list-tree" class="w-5 h-5" />
          </button>
          <button
            v-if="allowShare"
            class="flex-1 flex items-center justify-center py-1 text-sm font-medium border-b-2 transition-colors"
            :class="activeTab === 'share'
              ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 border-primary'
              : 'text-gray-600 dark:text-gray-400 border-transparent hover:bg-gray-100 dark:hover:bg-gray-800'"
            title="共享"
            @click="activeTab = 'share'"
          >
            <UIcon name="i-lucide-share-2" class="w-5 h-5" />
          </button>
          <button
            class="flex-1 flex items-center justify-center py-1 text-sm font-medium border-b-2 transition-colors"
            :class="activeTab === 'history'
              ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 border-primary'
              : 'text-gray-600 dark:text-gray-400 border-transparent hover:bg-gray-100 dark:hover:bg-gray-800'"
            title="版本"
            @click="switchToHistory"
          >
            <UIcon name="i-lucide-history" class="w-5 h-5" />
          </button>
          <button
            v-if="viewMode === 'edit'"
            class="flex-1 flex items-center justify-center py-1 text-sm font-medium border-b-2 transition-colors"
            :class="activeTab === 'annotations'
              ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 border-primary'
              : 'text-gray-600 dark:text-gray-400 border-transparent hover:bg-gray-100 dark:hover:bg-gray-800'"
            title="标注"
            @click="activeTab = 'annotations'"
          >
            <UIcon name="i-lucide-message-square-text" class="w-5 h-5" />
          </button>
          <button
            v-if="viewMode === 'edit'"
            class="flex-1 flex items-center justify-center py-1 text-sm font-medium border-b-2 transition-colors"
            :class="activeTab === 'ai'
              ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 border-primary'
              : 'text-gray-600 dark:text-gray-400 border-transparent hover:bg-gray-100 dark:hover:bg-gray-800'"
            title="AI"
            @click="activeTab = 'ai'"
          >
            <UIcon name="i-lucide-sparkles" class="w-5 h-5" />
          </button>
        </div>
        <!-- <UButton icon="i-lucide-x" variant="ghost" size="xs" @click="emit('close')" /> -->
      </div>
    </div>

    <!-- 标签页内容 -->
    <div class="flex-1 flex flex-col overflow-hidden min-h-0">
      <!-- 大纲标签页 -->
      <div
        v-show="activeTab === 'outline'"
        class="min-h-0 flex flex-col overflow-hidden"
        style="height: calc(100vh - 120px);"
      >
        <EditorOutline :markdown="markdown" :view-mode="viewMode" class="flex-1 min-h-0" />
      </div>

      <!-- 版本历史标签页 -->
      <div
        v-show="activeTab === 'history'"
        class="min-h-0 flex flex-col overflow-hidden"
        style="height: calc(100vh - 120px);"
      >
        <!-- 项目文档提示 -->
        <div v-if="isProjectDoc && getGitLabCommitsUrl() !== '#'" class="p-4">
          <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <div class="flex items-start gap-3">
              <UIcon name="i-lucide-info" class="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
              <div>
                <h4 class="font-medium text-blue-900 dark:text-blue-100 mb-1">
                  查看版本历史
                </h4>
                <p class="text-sm text-blue-700 dark:text-blue-300 mb-3">
                  项目文档的版本历史可通过 GitLab 查看
                </p>
                <a
                  :href="getGitLabCommitsUrl()"
                  target="_blank"
                  class="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <UIcon name="i-lucide-external-link" class="w-4 h-4" />
                  在 GitLab 中查看
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- Loading -->
        <div v-else-if="versionsLoading" class="flex-1 flex items-center justify-center py-20">
          <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
        </div>

        <!-- 版本列表 -->
        <div v-else-if="versions.length > 0" class="flex-1 min-h-0 overflow-y-auto p-3">
          <UAlert
            v-if="readonly"
            color="warning"
            icon="i-lucide-lock"
            title="当前文档为只读"
            description="只读状态下不可查看历史版本内容差异，也不可恢复历史版本。"
            class="mb-3"
          />
          <div class="relative">
            <!-- 时间线 -->
            <div class="absolute left-1.25 top-2 bottom-2 w-px bg-gray-200 dark:bg-gray-700" />

            <!-- 版本项 -->
            <div v-for="version in versions" :key="version.id" class="relative pl-6 pb-5">
              <!-- 时间线节点 -->
              <div
                class="absolute left-0 top-1 w-2.75 h-2.75 rounded-full ring-2"
                :class="activeVersionNum === version.versionNum
                  ? 'bg-primary ring-primary/30 scale-125'
                  : 'bg-gray-300 dark:bg-gray-600 ring-white dark:ring-gray-900'"
              />

              <!-- 时间戳（节点右侧） -->
              <div class="text-xs text-gray-500 dark:text-gray-400 mb-1.5 leading-none">
                {{ formatVersionDateTime(version.createdAt) }}
              </div>

              <!-- 版本卡片 -->
              <div
                class="rounded-lg border p-2.5 transition-all cursor-pointer"
                :class="activeVersionNum === version.versionNum
                  ? 'border-primary bg-primary-50 dark:bg-primary-900/20 shadow-sm'
                  : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-primary/40'"
                @click="!readonly && emit('view-version', version.id)"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5">
                    <span
                      class="text-xs font-semibold px-1.5 py-0.5 rounded"
                      :class="activeVersionNum === version.versionNum
                        ? 'bg-primary/10 text-primary'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'"
                    >v{{ version.versionNum }}</span>
                    <div
                      class="w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center text-[10px] font-medium text-primary"
                    >
                      {{ getInitial(version.editorName) }}
                    </div>
                    <span class="text-xs text-gray-600 dark:text-gray-300 truncate max-w-25">{{ version.editorName }}</span>
                  </div>
                  <span class="text-[10px] text-gray-400">{{ formatFileSize(version.contentSize) }}</span>
                </div>

                <!-- 操作按钮 -->
                <div class="flex items-center gap-2 mt-2">
                  <UButton
                    size="xs"
                    variant="soft"
                    :label="activeVersionNum === version.versionNum ? '查看中' : '查看'"
                    icon="i-lucide-eye"
                    :disabled="readonly || activeVersionNum === version.versionNum"
                    @click.stop="emit('view-version', version.id)"
                  />
                  <UButton
                    size="xs"
                    variant="ghost"
                    label="差异"
                    icon="i-lucide-git-compare"
                    :disabled="readonly"
                    @click.stop="emit('diff-version', version.id)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="flex-1 flex flex-col items-center justify-center py-20 px-4 text-center">
          <UIcon name="i-lucide-history" class="w-12 h-12 text-gray-400 mb-3" />
          <p class="text-sm text-gray-500 dark:text-gray-400">
            暂无版本历史
          </p>
        </div>
      </div>
      <!-- 共享标签页 -->
      <div v-if="allowShare" v-show="activeTab === 'share'">
        <EditorShare
          :document-id="documentId"
          :is-project-doc="isProjectDoc"
          :readonly="readonly"
          :can-manage="canManageShares"
          @share="(data) => emit('share', data)"
          @remove-share="(id) => emit('remove-share', id)"
          @update-permission="(data) => emit('update-permission', data)"
        />
      </div>

      <!-- 标注标签页 -->
      <div
        v-show="activeTab === 'annotations'"
        class="min-h-0 flex flex-col overflow-hidden"
        style="height: calc(100vh - 120px);"
      >
        <AnnotationPanel
          class="flex-1 min-h-0"
          :annotations="annotations"
          :current-user-id="currentUserId"
          @reply="(id, content) => emit('reply-annotation', id, content)"
          @resolve="(id) => emit('resolve-annotation', id)"
          @delete="(id) => emit('delete-annotation', id)"
          @delete-reply="(id, replyId) => emit('delete-reply', id, replyId)"
          @click-card="(id) => emit('click-annotation', id)"
        />
      </div>

      <!-- AI 标签页 -->
      <div
        v-show="activeTab === 'ai'"
        class="min-h-0 flex flex-col overflow-hidden"
        style="height: calc(100vh - 120px);"
      >
        <EditorAiPanel
          :markdown="markdown"
          :document-id="documentId"
          :saved-abstract="aiAbstract"
          :readonly="readonly"
          @update-abstract="(text: string) => emit('update-abstract', text)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 确保内部组件填满容器 */
:deep(.editor-outline) {
  height: 100%;
  border: none;
}
</style>
