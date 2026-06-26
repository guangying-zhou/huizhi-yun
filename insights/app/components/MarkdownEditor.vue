<template>
  <div class="markdown-editor">
    <!-- Toolbar -->
    <div class="editor-toolbar border-b border-gray-200 dark:border-gray-700">
      <div class="flex items-center gap-1 p-2">
        <!-- Basic formatting -->
        <UButtonGroup size="sm">
          <UButton variant="ghost" icon="i-heroicons-bold" @click="insertMarkdown('**', '**')" title="Bold" />
          <UButton variant="ghost" icon="i-heroicons-italic" @click="insertMarkdown('*', '*')" title="Italic" />
          <UButton variant="ghost" icon="i-heroicons-strikethrough" @click="insertMarkdown('~~', '~~')"
            title="Strikethrough" />
          <UButton variant="ghost" icon="i-heroicons-code-bracket" @click="insertMarkdown('`', '`')"
            title="Inline Code" />
        </UButtonGroup>

        <USeparator orientation="vertical" class="mx-2" />

        <!-- Headings -->
        <USelectMenu v-model="selectedHeading" :options="headingOptions"
          @update:model-value="(value: any) => insertHeading(value?.value || value)" size="sm" class="w-32" />

        <USeparator orientation="vertical" class="mx-2" />

        <!-- Lists and Links -->
        <UButtonGroup size="sm">
          <UButton variant="ghost" icon="i-heroicons-list-bullet" @click="insertList('unordered')"
            title="Bullet List" />
          <UButton variant="ghost" icon="i-heroicons-numbered-list" @click="insertList('ordered')"
            title="Numbered List" />
          <UButton variant="ghost" icon="i-heroicons-link" @click="insertLink" title="Link" />
          <UButton variant="ghost" icon="i-heroicons-photo" @click="insertImage" title="Image" />
        </UButtonGroup>

        <USeparator orientation="vertical" class="mx-2" />

        <!-- Special -->
        <UButtonGroup size="sm">
          <UButton variant="ghost" icon="i-heroicons-chat-bubble-left-right" @click="insertBlockquote" title="Quote" />
          <UButton variant="ghost" icon="i-heroicons-code-bracket-square" @click="insertCodeBlock" title="Code Block" />
          <UButton variant="ghost" icon="i-heroicons-table-cells" @click="insertTable" title="Table" />
        </UButtonGroup>

        <div class="flex-1"></div>

        <!-- View Mode Toggle -->
        <UButtonGroup size="sm">
          <UButton :variant="viewMode === 'edit' ? 'solid' : 'ghost'" icon="i-heroicons-pencil"
            @click="viewMode = 'edit'">
            Edit
          </UButton>
          <UButton :variant="viewMode === 'preview' ? 'solid' : 'ghost'" icon="i-heroicons-eye"
            @click="viewMode = 'preview'">
            Preview
          </UButton>
          <UButton :variant="viewMode === 'split' ? 'solid' : 'ghost'" icon="i-heroicons-view-columns"
            @click="viewMode = 'split'">
            Split
          </UButton>
        </UButtonGroup>
      </div>
    </div>

    <!-- Editor Content -->
    <div class="editor-content" :class="getContentClass()">
      <!-- Edit Mode -->
      <div v-if="viewMode === 'edit' || viewMode === 'split'" class="editor-pane">
        <textarea ref="textareaRef" v-model="localContent" :placeholder="placeholder"
          class="w-full h-full resize-none border-0 outline-none p-4 font-mono text-sm bg-transparent"
          @input="handleInput" @keydown="handleKeydown" @scroll="handleScroll" />
      </div>

      <!-- Preview Mode -->
      <div v-if="viewMode === 'preview' || viewMode === 'split'" class="preview-pane">
        <div class="p-4 prose prose-sm sm:prose lg:prose-lg xl:prose-2xl max-w-none dark:prose-invert">
          <div v-if="localContent.trim()" v-html="renderedHTML" />
          <div v-else class="text-gray-500 italic">
            No content to preview...
          </div>
        </div>
      </div>
    </div>

    <!-- Status Bar -->
    <div
      class="status-bar border-t border-gray-200 dark:border-gray-700 px-4 py-2 text-xs text-gray-500 flex items-center justify-between">
      <div class="flex items-center gap-4">
        <span>Lines: {{ lineCount }}</span>
        <span>Words: {{ wordCount }}</span>
        <span>Characters: {{ charCount }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="lastSaved">Last saved: {{ formatTime(lastSaved) }}</span>
        <UIcon v-if="isSaving" name="i-heroicons-arrow-path" class="animate-spin" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  modelValue: string
  placeholder?: string
  height?: string
  autoSave?: boolean
  saveInterval?: number
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Start writing your content...',
  height: '500px',
  autoSave: true,
  saveInterval: 2000
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'save': [content: string]
}>()

// Reactive state
const localContent = ref(props.modelValue)
const viewMode = ref<'edit' | 'preview' | 'split'>('edit')
const selectedHeading = ref('paragraph')
const textareaRef = ref<HTMLTextAreaElement>()
const isSaving = ref(false)
const lastSaved = ref<Date | null>(null)

// Heading options
const headingOptions = [
  { label: 'Paragraph', value: 'paragraph' },
  { label: 'Heading 1', value: 'h1' },
  { label: 'Heading 2', value: 'h2' },
  { label: 'Heading 3', value: 'h3' },
  { label: 'Heading 4', value: 'h4' },
  { label: 'Heading 5', value: 'h5' },
  { label: 'Heading 6', value: 'h6' }
]

// Computed properties
const lineCount = computed(() => localContent.value.split('\n').length)
const wordCount = computed(() => localContent.value.trim().split(/\s+/).filter(word => word.length > 0).length)
const charCount = computed(() => localContent.value.length)

// Simple markdown to HTML converter for preview
const renderedHTML = computed(() => {
  if (!localContent.value.trim()) return ''

  try {
    return parseMarkdownToHTML(localContent.value)
  } catch (error) {
    console.error('Error parsing markdown:', error)
    return `<p>Error rendering markdown: ${(error as Error)?.message || 'Unknown error'}</p>`
  }
})

// Simple markdown parser for preview
const parseMarkdownToHTML = (markdown: string) => {
  let html = markdown

  // Headers
  html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>')
  html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>')
  html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>')
  html = html.replace(/^#### (.*$)/gm, '<h4>$1</h4>')
  html = html.replace(/^##### (.*$)/gm, '<h5>$1</h5>')
  html = html.replace(/^###### (.*$)/gm, '<h6>$1</h6>')

  // Bold and italic
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')

  // Strikethrough
  html = html.replace(/~~(.*?)~~/g, '<del>$1</del>')

  // Code
  html = html.replace(/`(.*?)`/g, '<code>$1</code>')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="max-w-full h-auto rounded-lg" />')

  // Line breaks
  html = html.replace(/\n\n/g, '</p><p>')
  html = html.replace(/\n/g, '<br>')

  // Wrap in paragraphs
  html = '<p>' + html + '</p>'

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, '')
  html = html.replace(/<p>(<h[1-6]>.*?<\/h[1-6]>)<\/p>/g, '$1')

  return html
}

// Computed class for content area
const getContentClass = () => {
  const baseClass = 'flex h-full'
  switch (viewMode.value) {
    case 'edit':
      return `${baseClass} edit-only`
    case 'preview':
      return `${baseClass} preview-only`
    case 'split':
      return `${baseClass} split-view`
    default:
      return baseClass
  }
}

// Watch for external changes
watch(() => props.modelValue, (newValue) => {
  if (newValue !== localContent.value) {
    localContent.value = newValue
  }
})

// Handle input
const handleInput = () => {
  emit('update:modelValue', localContent.value)

  if (props.autoSave) {
    debouncedSave()
  }
}

// Auto-save functionality
const saveTimer = ref<NodeJS.Timeout | null>(null)
const debouncedSave = () => {
  if (saveTimer.value) {
    clearTimeout(saveTimer.value)
  }

  saveTimer.value = setTimeout(() => {
    save()
  }, props.saveInterval)
}

const save = async () => {
  isSaving.value = true
  try {
    emit('save', localContent.value)
    lastSaved.value = new Date()
  } finally {
    isSaving.value = false
  }
}

// Markdown insertion helpers
const insertMarkdown = (before: string, after: string = '') => {
  const textarea = textareaRef.value
  if (!textarea) return

  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selectedText = localContent.value.substring(start, end)

  const replacement = before + selectedText + after

  localContent.value =
    localContent.value.substring(0, start) +
    replacement +
    localContent.value.substring(end)

  nextTick(() => {
    textarea.focus()
    const newCursorPos = start + before.length + selectedText.length
    textarea.setSelectionRange(newCursorPos, newCursorPos)
  })

  handleInput()
}

const insertHeading = (value: string) => {
  if (value === 'paragraph') {
    selectedHeading.value = 'paragraph'
    return
  }

  const level = parseInt(value.replace('h', ''))
  const prefix = '#'.repeat(level) + ' '

  insertAtLineStart(prefix)
  selectedHeading.value = 'paragraph'
}

const insertAtLineStart = (text: string) => {
  const textarea = textareaRef.value
  if (!textarea) return

  const start = textarea.selectionStart
  const lineStart = localContent.value.lastIndexOf('\n', start - 1) + 1

  localContent.value =
    localContent.value.substring(0, lineStart) +
    text +
    localContent.value.substring(lineStart)

  nextTick(() => {
    textarea.focus()
    const newCursorPos = start + text.length
    textarea.setSelectionRange(newCursorPos, newCursorPos)
  })

  handleInput()
}

const insertList = (type: 'ordered' | 'unordered') => {
  const prefix = type === 'ordered' ? '1. ' : '- '
  insertAtLineStart(prefix)
}

const insertLink = () => {
  insertMarkdown('[', '](url)')
}

const insertImage = () => {
  insertMarkdown('![alt text](', ')')
}

const insertBlockquote = () => {
  insertAtLineStart('> ')
}

const insertCodeBlock = () => {
  insertMarkdown('\n```\n', '\n```\n')
}

const insertTable = () => {
  const table = `
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
`
  insertMarkdown(table, '')
}

// Keyboard shortcuts
const handleKeydown = (event: KeyboardEvent) => {
  if (event.ctrlKey || event.metaKey) {
    switch (event.key) {
      case 'b':
        event.preventDefault()
        insertMarkdown('**', '**')
        break
      case 'i':
        event.preventDefault()
        insertMarkdown('*', '*')
        break
      case 's':
        event.preventDefault()
        save()
        break
    }
  }

  // Tab handling for indentation
  if (event.key === 'Tab') {
    event.preventDefault()
    insertMarkdown('  ', '')
  }
}

// Scroll synchronization (for split view)
const handleScroll = () => {
  // Implement scroll sync between editor and preview if needed
}

// Utility functions
const formatTime = (date: Date) => {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Cleanup
onBeforeUnmount(() => {
  if (saveTimer.value) {
    clearTimeout(saveTimer.value)
  }
})
</script>

<style scoped>
.markdown-editor {
  display: flex;
  flex-direction: column;
  height: v-bind(height);
  border: 1px solid rgb(229, 231, 235);
  border-radius: 0.5rem;
  overflow: hidden;
  background-color: white;
}

.dark .markdown-editor {
  border-color: rgb(55, 65, 81);
  background-color: rgb(17, 24, 39);
}

.editor-content {
  flex: 1;
  overflow: hidden;
}

.editor-pane,
.preview-pane {
  overflow-y: auto;
}

.edit-only .editor-pane {
  width: 100%;
}

.preview-only .preview-pane {
  width: 100%;
}

.split-view .editor-pane {
  width: 50%;
  border-right: 1px solid rgb(229, 231, 235);
}

.dark .split-view .editor-pane {
  border-right-color: rgb(55, 65, 81);
}

.split-view .preview-pane {
  width: 50%;
}

.status-bar {
  background-color: rgb(249, 250, 251);
}

.dark .status-bar {
  background-color: rgb(31, 41, 55);
}

/* Scrollbar styling */
.editor-pane::-webkit-scrollbar,
.preview-pane::-webkit-scrollbar {
  width: 0.5rem;
}

.editor-pane::-webkit-scrollbar-track,
.preview-pane::-webkit-scrollbar-track {
  background-color: rgb(243, 244, 246);
}

.dark .editor-pane::-webkit-scrollbar-track,
.dark .preview-pane::-webkit-scrollbar-track {
  background-color: rgb(31, 41, 55);
}

.editor-pane::-webkit-scrollbar-thumb,
.preview-pane::-webkit-scrollbar-thumb {
  background-color: rgb(209, 213, 219);
  border-radius: 9999px;
}

.dark .editor-pane::-webkit-scrollbar-thumb,
.dark .preview-pane::-webkit-scrollbar-thumb {
  background-color: rgb(75, 85, 99);
}
</style>