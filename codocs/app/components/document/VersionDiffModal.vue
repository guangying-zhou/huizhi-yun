<script setup lang="ts">
import { diffLines } from 'diff'

interface Props {
  open: boolean
  versionNum: number
  editorUid: string
  createdAt: string
  historyContent: string
  currentContent: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'restore': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: (val: boolean) => emit('update:open', val)
})

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged'
  content: string
  currentLineNum: number | null
  historyLineNum: number | null
}

// diff(当前版本, 历史版本)：removed = 当前版本有、历史版本无；added = 历史版本有、当前版本无
const diffResult = computed<DiffLine[]>(() => {
  const changes = diffLines(props.currentContent, props.historyContent)
  const lines: DiffLine[] = []
  let currentLine = 1
  let historyLine = 1

  for (const change of changes) {
    const text = change.value.replace(/\n$/, '')
    const subLines = text.split('\n')

    for (const sub of subLines) {
      if (change.removed) {
        // 当前版本有，历史版本无
        lines.push({ type: 'removed', content: sub, currentLineNum: currentLine++, historyLineNum: null })
      } else if (change.added) {
        // 历史版本有，当前版本无
        lines.push({ type: 'added', content: sub, currentLineNum: null, historyLineNum: historyLine++ })
      } else {
        lines.push({ type: 'unchanged', content: sub, currentLineNum: currentLine++, historyLineNum: historyLine++ })
      }
    }
  }

  return lines
})

const stats = computed(() => {
  let added = 0
  let removed = 0
  for (const line of diffResult.value) {
    if (line.type === 'added') added++
    else if (line.type === 'removed') removed++
  }
  return { added, removed }
})

const formatDateTime = (dateStr: string) => {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}/${m}/${d} ${h}:${min}`
}
</script>

<template>
  <UModal v-model:open="isOpen" class="w-full max-w-6xl">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-git-compare" class="w-5 h-5 text-primary" />
              <div>
                <h3 class="text-base font-semibold">
                  版本差异对比
                </h3>
                <div class="text-xs text-muted mt-0.5">
                  当前版本 vs 历史版本 v{{ versionNum }}（{{ editorUid }}，{{ formatDateTime(createdAt) }}）
                </div>
              </div>
            </div>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              @click="isOpen = false"
            />
          </div>
        </template>

        <!-- 统计信息 -->
        <div class="flex items-center gap-4 mb-3 text-sm flex-wrap">
          <span class="flex items-center gap-1 text-success">
            <UIcon name="i-lucide-plus" class="w-3.5 h-3.5" />
            {{ stats.removed }} 行仅当前版本有
          </span>
          <span class="flex items-center gap-1 text-error">
            <UIcon name="i-lucide-minus" class="w-3.5 h-3.5" />
            {{ stats.added }} 行仅历史版本有
          </span>
          <div class="flex-1" />
          <div class="flex items-center gap-3 text-xs text-muted">
            <span class="inline-flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-success/15 border border-success/30" /> 当前版本新增</span>
            <span class="inline-flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-error/15 border border-error/30" /> 历史版本删除</span>
          </div>
        </div>

        <!-- Diff 内容 -->
        <div class="border border-default rounded-lg overflow-hidden max-h-[60vh] overflow-y-auto">
          <table class="w-full text-xs font-mono">
            <thead class="sticky top-0 bg-gray-100 dark:bg-gray-800 text-muted z-10">
              <tr>
                <th class="w-10 text-center px-2 py-1.5 border-r border-default font-medium">
                  当前
                </th>
                <th class="w-10 text-center px-2 py-1.5 border-r border-default font-medium">
                  v{{ versionNum }}
                </th>
                <th class="w-5 py-1.5" />
                <th class="py-1.5 pl-1 text-left font-medium">
                  内容
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(line, index) in diffResult"
                :key="index"
                :class="{
                  'bg-success-50 dark:bg-success-900/15': line.type === 'removed',
                  'bg-error-50 dark:bg-error-900/15': line.type === 'added'
                }"
              >
                <!-- 当前版本行号 -->
                <td
                  class="w-10 text-right px-2 py-0.5 select-none border-r border-default"
                  :class="{
                    'text-success/60': line.type === 'removed',
                    'text-muted': line.type !== 'removed'
                  }"
                >
                  {{ line.currentLineNum ?? '' }}
                </td>
                <!-- 历史版本行号 -->
                <td
                  class="w-10 text-right px-2 py-0.5 select-none border-r border-default"
                  :class="{
                    'text-error/60': line.type === 'added',
                    'text-muted': line.type !== 'added'
                  }"
                >
                  {{ line.historyLineNum ?? '' }}
                </td>
                <!-- 标记符号 -->
                <td
                  class="w-5 text-center py-0.5 select-none"
                  :class="{
                    'text-success font-bold': line.type === 'removed',
                    'text-error font-bold': line.type === 'added'
                  }"
                >
                  {{ line.type === 'removed' ? '+' : line.type === 'added' ? '-' : '' }}
                </td>
                <!-- 内容 -->
                <td class="py-0.5 pr-4 whitespace-pre-wrap break-all">
                  {{ line.content }}
                </td>
              </tr>
              <tr v-if="diffResult.length === 0">
                <td colspan="4" class="text-center py-8 text-muted">
                  两个版本内容完全相同
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <template #footer>
          <div class="flex justify-between items-center">
            <p class="text-xs text-muted">
              恢复后将替换当前文档内容并自动保存
            </p>
            <div class="flex gap-2">
              <UButton color="neutral" variant="outline" @click="isOpen = false">
                关闭
              </UButton>
              <UButton
                color="warning"
                icon="i-lucide-rotate-ccw"
                @click="emit('restore')"
              >
                恢复到此版本
              </UButton>
            </div>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
