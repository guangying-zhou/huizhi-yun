<script setup lang="ts">
import { presenceLabels, type PresenceMember } from '../../utils/collaborationPresence'

const props = defineProps<{ members: PresenceMember[], selfId: string, connected?: boolean }>()
const presentCount = computed(() => props.members.filter(member => member.status === 'online').length)
const awayCount = computed(() => props.members.filter(member => member.status === 'away').length)
const visible = computed(() => props.members.slice(0, 4))
const hidden = computed(() => props.members.slice(4))
const label = (member: PresenceMember) => {
  const detail = member.status === 'away' ? '（页面在后台或暂未操作）' : member.status === 'offline' ? props.connected === false ? '（当前协同连接已断开）' : '（连接断开或状态超时）' : ''
  return `${member.name}${member.id === props.selfId ? '（我）' : ''} · ${presenceLabels[member.status]}${detail}`
}
</script>

<template>
  <div v-if="members.length" class="flex min-w-0 items-center gap-2" aria-label="协同成员">
    <span class="whitespace-nowrap text-xs text-muted">在线 {{ presentCount }} 人<span v-if="awayCount"> · 离开 {{ awayCount }}</span></span>
    <UTooltip v-for="member in visible" :key="member.id" :text="label(member)">
      <span
        tabindex="0"
        :aria-label="label(member)"
        class="inline-flex shrink-0 flex-col items-center gap-0.5"
        :class="{ 'opacity-50': member.status === 'offline' }"
      >
        <span class="inline-flex size-8 items-center justify-center rounded-full border-2 text-xs font-semibold text-default" :style="{ borderColor: member.color, backgroundColor: `${member.color}20` }">{{ [...member.name][0] }}</span>
        <span class="text-[10px] leading-none" :class="member.status === 'online' ? 'text-success' : 'text-muted'">{{ presenceLabels[member.status] }}</span>
      </span>
    </UTooltip>
    <UPopover v-if="hidden.length">
      <UButton
        size="xs"
        color="neutral"
        variant="soft"
        :label="`+${hidden.length}`"
        aria-label="查看其他协同成员"
      />
      <template #content>
        <div class="max-h-64 overflow-y-auto p-3 text-sm">
          <div v-for="member in hidden" :key="member.id">
            {{ label(member) }}
          </div>
        </div>
      </template>
    </UPopover>
  </div>
</template>
