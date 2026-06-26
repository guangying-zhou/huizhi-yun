<script setup lang="ts">
/**
 * 嵌入式文档编辑器
 *
 * 供其他模块通过 iframe 嵌入使用。
 * 精简版：只有编辑器，无侧边栏/导航栏。
 * 支持实时协作（Hocuspocus）和自动保存。
 *
 * URL 参数：
 *  - readonly=1  只读预览模式
 *  - toolbar=0   隐藏编辑器工具栏
 *  - title=0     隐藏标题栏
 *
 * postMessage API（发送给父页面）：
 *  - { type: 'codocs:ready', uuid }           编辑器就绪
 *  - { type: 'codocs:change', uuid, content } 内容变化
 *  - { type: 'codocs:saved', uuid }           保存完成
 *  - { type: 'codocs:error', uuid, message }  错误
 *
 * postMessage API（接收来自父页面）：
 *  - { type: 'codocs:save' }                  触发保存
 *  - { type: 'codocs:getContent' }            获取当前内容
 */

definePageMeta({
  layout: 'embed'
})

const route = useRoute()
const { user: authUser } = useAuth()
const authUserId = computed(() => authUser.value || '')

const documentId = computed(() => route.params.uuid as string)
const isReadonly = computed(() => route.query.readonly === '1')
const showTitle = computed(() => route.query.title !== '0')
const showToolbar = computed(() => route.query.toolbar !== '0')
const useReadonlyPreview = computed(() => (isReadonly.value || docReadonly.value) && viewMode.value === 'richtext')
const editorContainerHeight = computed(() => {
  const chromeRows = [
    showTitle.value && Boolean(docTitle.value),
    showToolbar.value
  ].filter(Boolean).length

  if (chromeRows === 0) return '100vh'
  return `calc(100vh - ${chromeRows * 40}px)`
})

interface DocResponse {
  success: boolean
  data: {
    id?: number
    title?: string
    content?: string
    doc_type?: string
    owner_uid?: string
    readonly_flag?: number
    oss_path?: string
  }
}

// 文档状态
const docTitle = ref('')
const editorContent = ref('')
const docType = ref('')
const docReadonly = ref(false)
const loading = ref(true)
const error = ref('')
const saving = ref(false)

// 编辑器引用
const editorRef = ref<{ getMarkdown: () => string } | null>(null)

// 是否有未保存的变更
const hasUnsavedChanges = ref(false)

// 图文/源码模式切换
type ViewMode = 'richtext' | 'source'
const viewMode = ref<ViewMode>('richtext')

const toggleViewMode = () => {
  viewMode.value = viewMode.value === 'richtext' ? 'source' : 'richtext'
}

// 源码编辑时的内容处理
const handleSourceInput = (e: Event) => {
  const value = (e.target as HTMLTextAreaElement).value
  editorContent.value = value
  hasUnsavedChanges.value = true
  notifyParent('codocs:change', { content: value })

  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(saveDocument, AUTO_SAVE_DELAY)
}

// 自动保存定时器
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
const AUTO_SAVE_DELAY = 3000

// 协作（嵌入模式暂不启用，后续按需接入）

// 加载文档
const loadDocument = async () => {
  loading.value = true
  error.value = ''

  try {
    const res = await $fetch<DocResponse>(`/api/documents/${documentId.value}`, {
      params: { uid: authUserId.value }
    })

    if (res.success && res.data) {
      docTitle.value = res.data.title || ''
      editorContent.value = res.data.content || ''
      docType.value = res.data.doc_type || 'private'
      docReadonly.value = !!res.data.readonly_flag
    }
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }, message?: string }
    error.value = e.data?.message || e.message || '加载文档失败'
    notifyParent('codocs:error', { message: error.value })
  } finally {
    loading.value = false
  }
}

// 保存文档
const saveDocument = async (force = false) => {
  if (isReadonly.value || docReadonly.value) return
  if (!force && !hasUnsavedChanges.value) return

  saving.value = true
  try {
    await $fetch(`/api/documents/${documentId.value}`, {
      method: 'PUT',
      body: {
        content: editorContent.value,
        saveMode: 'overwrite'
      }
    })
    hasUnsavedChanges.value = false
    notifyParent('codocs:saved', {})
  } catch {
    // 静默
  } finally {
    saving.value = false
  }
}

// 内容变化处理
const handleContentChange = (content: string) => {
  editorContent.value = content
  hasUnsavedChanges.value = true
  notifyParent('codocs:change', { content })

  // 自动保存（防抖）
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(saveDocument, AUTO_SAVE_DELAY)
}

// 编辑器就绪
const handleEditorReady = () => {
  notifyParent('codocs:ready', {})
}

// 通知父页面
const notifyParent = (type: string, data: Record<string, unknown>) => {
  if (!window.parent || window.parent === window) return
  window.parent.postMessage({
    type,
    uuid: documentId.value,
    ...data
  }, '*')
}

// 监听父页面消息
const onMessage = (e: MessageEvent) => {
  const { type } = e.data || {}
  if (type === 'codocs:save') {
    saveDocument()
  } else if (type === 'codocs:getContent') {
    notifyParent('codocs:content', { content: editorContent.value })
  }
}

// 拦截 Ctrl+S / Cmd+S
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    saveDocument(true)
  }
}

onMounted(() => {
  loadDocument()
  window.addEventListener('message', onMessage)
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('message', onMessage)
  window.removeEventListener('keydown', onKeydown)
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
})
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 标题栏（可选） -->
    <div
      v-if="showTitle && docTitle"
      class="flex items-center gap-2 px-4 py-1.5 border-b border-default bg-default shrink-0 min-w-0"
    >
      <UIcon name="i-lucide-file-text" class="w-4 h-4 text-muted shrink-0" />
      <span class="text-sm font-medium text-default truncate">{{ docTitle }}</span>
    </div>

    <!-- 工具栏（始终显示） -->
    <div
      v-if="showToolbar && !loading && !error"
      class="flex items-center justify-between px-4 py-1.5 border-b border-default bg-default shrink-0"
    >
      <div v-if="!isReadonly && !docReadonly" class="flex items-center gap-2">
        <UButton
          icon="i-lucide-save"
          label="保存"
          size="xs"
          :color="hasUnsavedChanges ? 'primary' : 'neutral'"
          :variant="hasUnsavedChanges ? 'soft' : 'ghost'"
          :loading="saving"
          :disabled="!hasUnsavedChanges"
          @click="saveDocument(true)"
        />
        <span v-if="saving" class="text-xs text-muted">保存中...</span>
        <span v-else-if="hasUnsavedChanges" class="text-xs text-warning">有未保存的更改</span>
        <span v-else class="text-xs text-success">已保存</span>
      </div>
      <div class="flex items-center gap-2">
        <UBadge
          v-if="docReadonly || isReadonly"
          label="只读"
          color="neutral"
          size="xs"
        />
        <UButton
          :icon="viewMode === 'richtext' ? 'i-lucide-code' : 'i-lucide-eye'"
          :label="viewMode === 'richtext' ? '源码' : '图文'"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="toggleViewMode"
        />
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <UIcon name="i-lucide-loader-2" class="w-8 h-8 text-primary animate-spin" />
    </div>

    <!-- 错误 -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center p-4">
      <div class="text-center">
        <UIcon name="i-lucide-alert-circle" class="w-10 h-10 text-error mx-auto mb-3" />
        <p class="text-sm text-default">
          {{ error }}
        </p>
      </div>
    </div>

    <!-- 编辑器 -->
    <div v-else class="flex-1 overflow-hidden">
      <!-- 只读预览模式 -->
      <div
        v-if="useReadonlyPreview"
        class="h-full overflow-y-auto bg-white dark:bg-gray-900"
      >
        <div class="mx-auto min-h-full w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
          <EditorDocLazyPreview
            v-if="editorContent"
            :content="editorContent"
          />
        </div>
      </div>

      <!-- 图文模式 -->
      <ClientOnly v-else-if="viewMode === 'richtext'">
        <EditorMilkdownEditor
          ref="editorRef"
          v-model="editorContent"
          :readonly="isReadonly || docReadonly"
          :show-sidebar="false"
          :doc-type="docType"
          :collaboration-enabled="false"
          :container-height="editorContainerHeight"
          @change="handleContentChange"
          @ready="handleEditorReady"
        />
      </ClientOnly>

      <!-- 源码模式 -->
      <div v-else class="w-full h-full overflow-y-auto bg-gray-50 dark:bg-gray-900 flex justify-center">
        <textarea
          :value="editorContent"
          :readonly="isReadonly || docReadonly"
          class="w-full max-w-4xl min-h-full font-mono text-sm leading-relaxed py-8 px-4 sm:py-16 sm:px-8 bg-transparent resize-none focus:outline-none"
          spellcheck="false"
          @input="handleSourceInput"
        />
      </div>
    </div>
  </div>
</template>
