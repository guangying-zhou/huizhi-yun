<script setup lang="ts">
type JobEvent = {
  sequence: number
  level: string
  message: string
  createdAt: string
}

type EventTone = 'system' | 'output' | 'error' | 'info'

type EventGroup = {
  key: string
  tone: EventTone
  title: string
  icon: string
  startSequence: number
  endSequence: number
  createdAt: string
  events: JobEvent[]
}

const props = withDefaults(defineProps<{
  events: JobEvent[]
  active?: boolean
  compact?: boolean
}>(), {
  active: false,
  compact: false
})

const groupedEvents = computed<EventGroup[]>(() => {
  const groups: EventGroup[] = []

  for (const event of props.events) {
    const tone = eventTone(event)
    const previous = groups.at(-1)
    if (previous && previous.tone === tone) {
      previous.events.push(event)
      previous.endSequence = event.sequence
      continue
    }

    groups.push({
      key: `${event.sequence}-${tone}`,
      tone,
      title: groupTitle(tone),
      icon: groupIcon(tone),
      startSequence: event.sequence,
      endSequence: event.sequence,
      createdAt: event.createdAt,
      events: [event]
    })
  }

  return groups
})

function eventTone(event: JobEvent): EventTone {
  const level = String(event.level || '').toLowerCase()
  if (level === 'error' || level === 'stderr') return 'error'
  if (level === 'system') return 'system'
  if (level === 'stdout' || level === 'assistant') return 'output'
  return isErrorLikeOutput(event.message) ? 'error' : 'info'
}

function groupTitle(tone: EventTone) {
  switch (tone) {
    case 'system':
      return '任务状态'
    case 'output':
      return 'Codex 输出'
    case 'error':
      return '错误输出'
    default:
      return '运行信息'
  }
}

function groupIcon(tone: EventTone) {
  switch (tone) {
    case 'system':
      return 'i-lucide-circle-dot'
    case 'output':
      return 'i-lucide-terminal'
    case 'error':
      return 'i-lucide-circle-alert'
    default:
      return 'i-lucide-info'
  }
}

function groupIconClass(tone: EventTone) {
  switch (tone) {
    case 'system':
      return 'text-primary'
    case 'output':
      return 'text-success'
    case 'error':
      return 'text-error'
    default:
      return 'text-info'
  }
}

function groupFrameClass(tone: EventTone) {
  const base = 'rounded-md border px-3 py-2'
  switch (tone) {
    case 'error':
      return `${base} border-error/20 bg-error/5`
    default:
      return `${base} border-default bg-elevated/40`
  }
}

function lineClass(event: JobEvent) {
  const message = event.message || ''
  if (isDiffAdd(message)) return 'text-success'
  if (isDiffDelete(message)) return 'text-error'
  if (isDiffHunk(message)) return 'text-info'
  if (event.level === 'system' && message === 'job succeeded') return 'text-success'
  if (event.level === 'system' && message === 'job canceled') return 'text-warning'
  if (event.level === 'system' && isErrorLikeOutput(message)) return 'text-error'

  switch (eventTone(event)) {
    case 'error':
      return 'text-error'
    case 'system':
      return 'text-default'
    case 'info':
      return 'text-muted'
    default:
      return 'text-default'
  }
}

function displayMessage(event: JobEvent) {
  const message = event.message || ''
  if (event.level !== 'system') return message

  if (message === 'job queued') return '任务已排队'
  if (message === 'job started') return '开始执行'
  if (message === 'job succeeded') return '任务完成'
  if (message === 'job canceled') return '任务已取消'
  if (message === 'cancel requested') return '已请求停止'

  const templateMatch = message.match(/^running template (.+) in repo (.+)$/)
  if (templateMatch) {
    return `执行 ${templateMatch[1]} · ${templateMatch[2]}`
  }

  const attachmentMatch = message.match(/^attached (\d+) file\(s\): (.+)$/)
  if (attachmentMatch) {
    return `已附加 ${attachmentMatch[1]} 个文件 · ${attachmentMatch[2]}`
  }

  return message
}

function shouldConcatenateOutput(group: EventGroup) {
  if (group.tone !== 'output' || group.events.length < 4) return false
  if (group.events.some(event => String(event.level || '').toLowerCase() === 'assistant')) return true

  const shortFragments = group.events.filter((event) => {
    const message = event.message || ''
    return message.length <= 12 && !message.includes('\n')
  })
  return shortFragments.length / group.events.length >= 0.8
}

function concatenatedOutput(group: EventGroup) {
  return group.events.map(event => event.message || '').join('')
}

function sequenceLabel(group: EventGroup) {
  if (group.startSequence === group.endSequence) return `#${group.startSequence}`
  return `#${group.startSequence}-#${group.endSequence}`
}

function formatTime(value: string | undefined) {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(value))
  } catch {
    return value
  }
}

function isDiffAdd(message: string) {
  return message.startsWith('+') && !message.startsWith('+++')
}

function isDiffDelete(message: string) {
  return message.startsWith('-') && !message.startsWith('---')
}

function isDiffHunk(message: string) {
  return message.startsWith('@@') || message.startsWith('diff --git') || message.startsWith('index ')
}

function isErrorLikeOutput(message: string) {
  const lower = message.trim().toLowerCase()
  if (!lower) return false
  return [
    'error:',
    'fatal:',
    'panic:',
    'failed',
    'exception',
    'unauthorized',
    'permission denied',
    'could not resolve',
    'no such file',
    'not found'
  ].some(marker => lower.includes(marker))
}
</script>

<template>
  <div
    class="space-y-3"
    :class="compact ? 'text-xs' : 'text-sm'"
  >
    <div
      v-for="group in groupedEvents"
      :key="group.key"
      class="relative"
    >
      <div class="mb-1.5 flex items-center gap-2 text-xs">
        <UIcon
          :name="group.icon"
          class="size-3.5 shrink-0"
          :class="groupIconClass(group.tone)"
        />
        <span class="font-medium text-default">{{ group.title }}</span>
        <span class="font-mono text-muted">{{ sequenceLabel(group) }}</span>
        <span class="ml-auto text-muted">{{ formatTime(group.createdAt) }}</span>
      </div>

      <div :class="groupFrameClass(group.tone)">
        <div
          v-if="shouldConcatenateOutput(group)"
          class="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2 font-mono text-xs leading-5"
        >
          <span class="select-none text-right text-muted">{{ sequenceLabel(group) }}</span>
          <span
            class="min-w-0 whitespace-pre-wrap break-words text-default"
          >{{ concatenatedOutput(group) || ' ' }}</span>
        </div>
        <div v-else class="space-y-1 font-mono text-xs leading-5">
          <div
            v-for="event in group.events"
            :key="event.sequence"
            class="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2"
          >
            <span class="select-none text-right text-muted">{{ event.sequence }}</span>
            <span
              class="min-w-0 whitespace-pre-wrap break-words"
              :class="lineClass(event)"
            >{{ displayMessage(event) || ' ' }}</span>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="active"
      class="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2"
    >
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-primary" />
      <UChatShimmer
        text="Codex 正在执行"
        class="text-sm"
      />
    </div>
  </div>
</template>
