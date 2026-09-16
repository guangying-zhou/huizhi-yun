<script setup lang="ts">
// 深色终端 / 日志块，对齐原型设计词汇（浅色 UI + 深色终端）
export type TerminalLineTone = 'cmd' | 'out' | 'err' | 'ok' | 'info' | 'warn' | 'dim'

export type TerminalLine = {
  t?: TerminalLineTone
  s: string
}

withDefaults(defineProps<{
  title?: string
  lines: TerminalLine[]
}>(), {
  title: ''
})

const TONE_CLASS: Record<TerminalLineTone, string> = {
  cmd: 'text-zinc-200',
  out: 'text-zinc-400',
  err: 'text-red-400',
  ok: 'text-green-400',
  info: 'text-blue-400',
  warn: 'text-amber-400',
  dim: 'text-zinc-600'
}

function lineClass(tone: TerminalLineTone | undefined) {
  return TONE_CLASS[tone || 'out']
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
    <div
      v-if="title"
      class="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5"
    >
      <UIcon name="i-lucide-terminal" class="size-3 text-zinc-600" />
      <span class="font-mono text-[11px] text-zinc-500">{{ title }}</span>
    </div>
    <div class="px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed">
      <div
        v-for="(line, index) in lines"
        :key="index"
        class="whitespace-pre-wrap break-words"
        :class="lineClass(line.t)"
      >
        <span v-if="line.t === 'cmd'" class="text-green-400">$ </span>{{ line.s }}
      </div>
    </div>
  </div>
</template>
