<script setup lang="ts">
/**
 * AI 下拉菜单 + 结果预览面板
 * 由 Crepe 工具栏中的 AI 按钮触发，显示为下拉菜单
 * 选择操作后在预览面板中流式显示结果，用户可采纳或放弃
 * 结果面板分左右（大屏）或上下（小屏）对比显示原文与 AI 结果
 */

const props = defineProps<{
  visible: boolean
  selectedText: string
  position: { top: number, left: number }
}>()

const emit = defineEmits<{
  apply: [text: string]
  close: []
}>()

const { loading, error, rewrite, fixFormat, cancel } = useAi()

// AI 结果
const result = ref('')
const showResult = ref(false)
const currentAction = ref('')

// 下拉菜单容器
const menuRef = ref<HTMLElement | null>(null)

// 防止菜单上移后鼠标恰好在菜单项上触发误点击
const justOpened = ref(false)

// 实际渲染位置
const adjustedTop = ref(0)
const adjustedLeft = ref(0)

// 渲染后测量实际尺寸，修正位置确保不超出视口
const adjustPosition = () => {
  nextTick(() => {
    requestAnimationFrame(() => {
      const el = menuRef.value
      if (!el) return
      const margin = 8
      const rect = el.getBoundingClientRect()
      let top = props.position.top
      let left = props.position.left

      const minPanelHeight = showResult.value ? 160 : rect.height
      const neededHeight = Math.max(rect.height, minPanelHeight)

      if (top + neededHeight > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - neededHeight - margin)
      }
      if (left + rect.width > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - rect.width - margin)
      }

      adjustedTop.value = top
      adjustedLeft.value = left
    })
  })
}

// position 或 showResult 变化时重新调整
watch(() => props.position, adjustPosition, { deep: true })
watch(showResult, (isResult) => {
  if (isResult) {
    const minHeight = 250
    const margin = 8
    const maxTop = window.innerHeight - minHeight - margin
    if (adjustedTop.value > maxTop) {
      adjustedTop.value = Math.max(margin, maxTop)
    }
  }
  adjustPosition()
})
watch(() => props.visible, (v) => {
  if (v) {
    adjustedTop.value = props.position.top
    adjustedLeft.value = props.position.left
    adjustPosition()
    justOpened.value = true
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        justOpened.value = false
      })
    })
  }
})

// 操作列表
const actions = [
  { key: 'polish', label: '润色', icon: 'i-lucide-sparkles' },
  { key: 'simplify', label: '精简', icon: 'i-lucide-minimize-2' },
  { key: 'expand', label: '扩展', icon: 'i-lucide-maximize-2' },
  { key: 'fixFormat', label: '格式纠正', icon: 'i-lucide-wrench' },
  { key: 'translate', label: '翻译', icon: 'i-lucide-languages' }
]

// 执行 AI 操作
const handleAction = async (actionKey: string) => {
  if (justOpened.value || loading.value || !props.selectedText) return

  result.value = ''
  showResult.value = true
  currentAction.value = actionKey

  try {
    if (actionKey === 'fixFormat') {
      result.value = await fixFormat(props.selectedText)
    } else {
      await rewrite(
        props.selectedText,
        actionKey as 'polish' | 'simplify' | 'expand' | 'translate',
        (chunk) => { result.value += chunk }
      )
    }
  } catch {
    // error 已在 useAi 中设置
  }
}

// 采纳结果
const handleApply = () => {
  if (result.value) {
    emit('apply', result.value)
  }
  handleClose()
}

// 关闭/放弃
const handleClose = () => {
  cancel()
  result.value = ''
  showResult.value = false
  currentAction.value = ''
  emit('close')
}

// 重试
const handleRetry = () => {
  if (currentAction.value) {
    handleAction(currentAction.value)
  }
}

// 点击外部关闭（仅在菜单阶段，结果预览阶段不关闭）
const handleClickOutside = (e: MouseEvent) => {
  if (!props.visible || showResult.value) return
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    handleClose()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="fixed z-9999"
      :style="{ top: `${adjustedTop}px`, left: `${adjustedLeft}px` }"
    >
      <!-- 下拉菜单（纵向列表） -->
      <div
        v-if="!showResult"
        class="flex flex-col min-w-36 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg py-1"
        :class="{ 'pointer-events-none': justOpened }"
      >
        <button
          v-for="action in actions"
          :key="action.key"
          class="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 transition-colors hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:text-primary"
          @click="handleAction(action.key)"
        >
          <UIcon :name="action.icon" class="w-4 h-4" />
          <span>{{ action.label }}</span>
        </button>
      </div>

      <!-- 结果预览面板（对比视图） -->
      <div
        v-else
        class="flex flex-col bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl"
        :style="{
          width: 'min(720px, calc(100vw - 16px))',
          maxHeight: `calc(100vh - ${adjustedTop}px - 8px)`
        }"
      >
        <!-- 标题栏 -->
        <div class="shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-sparkles" class="w-4 h-4 text-primary" />
            <span class="text-xs font-medium text-gray-700 dark:text-gray-300">
              AI {{ actions.find(a => a.key === currentAction)?.label || '处理' }}
            </span>
            <UIcon v-if="loading" name="i-lucide-loader-2" class="w-3 h-3 animate-spin text-primary" />
          </div>
          <button
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            @click="handleClose"
          >
            <UIcon name="i-lucide-x" class="w-4 h-4" />
          </button>
        </div>

        <!-- 对比内容区域：大屏左右分，小屏上下分 -->
        <div class="flex-1 min-h-0 flex flex-col sm:flex-row overflow-hidden" style="min-height: 120px;">
          <!-- 原始内容 -->
          <div class="flex-1 min-h-0 flex flex-col border-b sm:border-b-0 sm:border-r border-gray-200 dark:border-gray-700">
            <div class="shrink-0 px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
              <span class="text-xs font-medium text-gray-500 dark:text-gray-400">原文</span>
            </div>
            <div class="flex-1 min-h-0 p-3 overflow-y-auto text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
              {{ selectedText }}
            </div>
          </div>

          <!-- AI 生成内容 -->
          <div class="flex-1 min-h-0 flex flex-col">
            <div class="shrink-0 px-3 py-1.5 bg-primary-50 dark:bg-primary-900/20 border-b border-gray-200 dark:border-gray-700">
              <span class="text-xs font-medium text-primary">AI 结果</span>
            </div>
            <div class="flex-1 min-h-0 p-3 overflow-y-auto">
              <!-- 错误提示 -->
              <div v-if="error" class="text-xs text-error bg-error/10 rounded p-2">
                {{ error }}
              </div>
              <!-- 结果文本 -->
              <div
                v-else
                class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap"
              >
                {{ result }}<span v-if="loading" class="inline-block w-0.5 h-4 bg-primary animate-pulse ml-0.5" />
              </div>
            </div>
          </div>
        </div>

        <!-- 操作栏 -->
        <div class="shrink-0 flex items-center justify-end gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700">
          <UButton
            size="xs"
            variant="ghost"
            label="放弃"
            @click="handleClose"
          />
          <UButton
            size="xs"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            label="重试"
            :disabled="loading"
            @click="handleRetry"
          />
          <UButton
            size="xs"
            variant="soft"
            color="primary"
            icon="i-lucide-check"
            label="采纳"
            :disabled="loading || !result"
            @click="handleApply"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>
