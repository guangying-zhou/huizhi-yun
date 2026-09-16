<script setup lang="ts">
/**
 * 编辑器大纲组件
 * 显示文档的标题结构，支持点击跳转
 */
import { ref, watch, computed } from 'vue'

interface HeadingNode {
  id: string
  level: number
  text: string
  startIndex: number
  children?: HeadingNode[]
}

interface Props {
  markdown: string
  viewMode?: 'edit' | 'source'
}

const props = defineProps<Props>()

const headings = ref<HeadingNode[]>([])
const activeId = ref<string>('')

// 从 Markdown 中提取标题
const extractHeadings = (markdown: string): HeadingNode[] => {
  if (!markdown) {
    // console.log('[EditorOutline] No markdown content')
    return []
  }

  const lines = markdown.split('\n')
  const result: HeadingNode[] = []
  const stack: HeadingNode[] = []

  // console.log('[EditorOutline] Processing', lines.length, 'lines')

  let currentPosition = 0

  lines.forEach((line, index) => {
    // 累加当前行长度（包括换行符）到位置索引
    // 注意：最后一行可能没有换行符，但我们在处理时通常认为行之间有分隔
    // 这里为了简化，假设每行后面都有换行符，或者依靠精确匹配
    // 更精确的做法是累加 line.length + 1
    const lineLength = line.length + 1

    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match && match[1] && match[2]) {
      const level = match[1].length
      const text = match[2].trim()
      const id = `heading-${index}-${text.replace(/\s+/g, '-').toLowerCase()}`

      // console.log('[EditorOutline] Found heading:', level, text)

      const node: HeadingNode = {
        id,
        level,
        text,
        startIndex: currentPosition,
        children: []
      }

      // 找到合适的父节点
      while (stack.length > 0) {
        const last = stack[stack.length - 1]
        if (last && last.level >= level) {
          stack.pop()
        } else {
          break
        }
      }

      if (stack.length === 0) {
        result.push(node)
      } else {
        const parent = stack[stack.length - 1]
        if (parent) {
          if (!parent.children) {
            parent.children = []
          }
          parent.children.push(node)
        }
      }

      stack.push(node)
    }

    currentPosition += lineLength
  })

  // console.log('[EditorOutline] Extracted', result.length, 'top-level headings')
  return result
}

// 监听 markdown 变化
watch(() => props.markdown, (newMarkdown) => {
  // console.log('[EditorOutline] Markdown changed, length:', newMarkdown?.length || 0)
  headings.value = extractHeadings(newMarkdown)
}, { immediate: true })

// 滚动到指定标题
const scrollToHeading = (heading: HeadingNode) => {
  activeId.value = heading.id

  if (props.viewMode === 'source') {
    // 源码模式：滚动 textarea
    const textarea = document.querySelector('.crepe-source-editor textarea') as HTMLTextAreaElement
    if (textarea && typeof heading.startIndex === 'number') {
      textarea.focus()
      textarea.setSelectionRange(heading.startIndex, heading.startIndex)

      // 计算滚动位置，尝试将光标置于中间
      // 简单的 scrollIntoView 可能不起作用，或者可以尝试 blur/focus trick
      // textarea.blur()
      // textarea.focus()

      // 更好的方法：计算行号并估算滚动
      // 这里 simplest approach: setSelectionRange and blur/focus usually scrolls to cursor
      // 或者使用 scrollIntoView 如果 text selection API 不足以滚动

      // 尝试模拟滚动：
      // 由于 textarea 内部难以精确定位像素，我们依赖浏览器自动滚动到光标

      // 另一种方式：获取 textarea 的行高，根据行数计算 scrollTop
      // 但现在我们只有 startIndex，需要重新计算行数
      const textBefore = props.markdown.substring(0, heading.startIndex)
      const lineNumber = textBefore.split('\n').length

      // 估算行高 (例如 24px)
      const lineHeight = 24
      // 加上 padding
      const offsetTop = 64 // py-16 = 4rem = 64px

      const scrollTop = (lineNumber - 1) * lineHeight + offsetTop - (textarea.clientHeight / 2)

      textarea.scrollTo({
        top: Math.max(0, scrollTop),
        behavior: 'smooth'
      })
    }
  } else {
    // 编辑/预览模式：滚动 Milkdown 内容
    // 查找编辑器中对应的标题元素
    const editor = document.querySelector('.milkdown')
    if (!editor) return

    // 在编辑器中查找对应的标题文本
    // 这种方法不太精确，如果有重名标题会跳到第一个
    // 但 Milkdown 生成的 ID 不可预测，暂时只能这样
    const headingElements = editor.querySelectorAll('h1, h2, h3, h4, h5, h6')
    for (const el of headingElements) {
      if (el.textContent?.trim() === heading.text) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        break
      }
    }
  }
}

// 获取缩进样式
const getIndentClass = (level: number) => {
  return `ml-${Math.min((level - 1) * 4, 12)}`
}

// 是否有内容
const hasContent = computed(() => headings.value.length > 0)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <!-- 大纲内容 -->
    <div v-if="hasContent" class="min-h-0 flex-1 overflow-y-auto p-2">
      <div v-for="heading in headings" :key="heading.id" class="mb-1">
        <!-- 一级标题 -->
        <button
          class="w-full text-left px-3 py-1.5 rounded text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-primary-500"
          :class="{
            'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400': activeId === heading.id,
            'font-semibold': heading.level === 1
          }"
          @click="scrollToHeading(heading)"
        >
          <span
            class="block truncate"
            :class="{
              'text-sm font-semibold': heading.level === 1
            }"
          >
            {{ heading.text }}
          </span>
        </button>

        <!-- 子标题 -->
        <template v-if="heading.children && heading.children.length > 0">
          <div v-for="child in heading.children" :key="child.id">
            <button
              class="w-full text-left px-3 py-1.5 rounded text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-primary-500"
              :class="{
                'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400': activeId === child.id,
                [getIndentClass(child.level)]: true
              }"
              @click="scrollToHeading(child)"
            >
              <span class="block truncate text-sm">
                {{ child.text }}
              </span>
            </button>

            <!-- 三级及以下标题 -->
            <template v-if="child?.children && child.children.length > 0">
              <button
                v-for="subChild in child.children"
                :key="subChild.id"
                class="w-full text-left px-3 py-1.5 rounded text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-primary-500"
                :class="{
                  'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400': activeId === subChild.id,
                  [getIndentClass(subChild.level)]: true
                }"
                @click="scrollToHeading(subChild)"
              >
                <span class="block truncate text-xs text-gray-600 dark:text-gray-400">
                  {{ subChild.text }}
                </span>
              </button>
            </template>
          </div>
        </template>
      </div>
    </div>

    <div v-else class="flex items-center justify-center p-8">
      <p class="text-xs text-gray-400 dark:text-gray-600">
        暂无大纲
      </p>
    </div>
  </div>
</template>

<style scoped>
/* 缩进类 */
.ml-0 {
  margin-left: 0;
}

.ml-4 {
  margin-left: 1rem;
}

.ml-8 {
  margin-left: 2rem;
}

.ml-12 {
  margin-left: 3rem;
}
</style>
