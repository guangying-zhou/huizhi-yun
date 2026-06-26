<script setup lang="ts">
import type { Milestone, ProjectCategory, PivrStage } from '~/types/aims'
import { pivrPhases, pivrTypeMapping } from '~/config/milestone'

const props = defineProps<{
  milestones: Milestone[]
  projectCategory: string
}>()

const stages: PivrStage[] = ['P', 'I', 'V', 'R']

const currentStage = computed(() => {
  // 找到最后一个 active 阶段，或第一个 todo/planning 阶段
  for (const ms of props.milestones) {
    if (ms.status === 'active' && ms.pivrStage) {
      return ms.pivrStage
    }
  }
  // 没有 active 的，优先找第一个 todo
  for (const ms of props.milestones) {
    if (ms.status === 'todo' && ms.pivrStage) {
      return ms.pivrStage
    }
  }
  // 仍然没有时，找第一个 planning
  for (const ms of props.milestones) {
    if (ms.status === 'planning' && ms.pivrStage) {
      return ms.pivrStage
    }
  }
  return null
})

function getStageInfo(stage: PivrStage) {
  const phase = pivrPhases[stage]
  const mapping = pivrTypeMapping[props.projectCategory as ProjectCategory]
  const typeInfo = mapping ? mapping[stage] : null
  return {
    ...phase,
    title: typeInfo?.title || phase.label,
    description: typeInfo?.description || phase.description
  }
}

function isCompleted(stage: PivrStage): boolean {
  const ms = props.milestones.find(m => m.pivrStage === stage)
  return ms?.status === 'completed'
}

function isActive(stage: PivrStage): boolean {
  return currentStage.value === stage
}
</script>

<template>
  <div class="flex items-start gap-0 w-full">
    <div
      v-for="(stage, index) in stages"
      :key="stage"
      class="flex-1 flex flex-col items-center relative"
    >
      <!-- 连接线 -->
      <div class="flex items-center w-full mb-2">
        <div
          class="flex-1 h-0.5"
          :class="index === 0 ? 'bg-transparent' : (isCompleted(stages[index - 1]!) ? 'bg-(--ui-primary)' : 'bg-(--ui-border)')"
        />
        <!-- 节点 -->
        <div
          class="shrink-0 size-8 rounded-full flex items-center justify-center text-sm font-bold transition-all"
          :class="[
            isCompleted(stage)
              ? 'bg-(--ui-primary) text-(--ui-bg)'
              : isActive(stage)
                ? 'ring-2 ring-(--ui-primary) bg-(--ui-bg) text-(--ui-primary)'
                : 'bg-(--ui-bg-accented) text-(--ui-text-dimmed)'
          ]"
        >
          <UIcon
            v-if="isCompleted(stage)"
            name="i-lucide-check"
            class="size-4"
          />
          <span v-else>{{ stage }}</span>
        </div>
        <div
          class="flex-1 h-0.5"
          :class="index === stages.length - 1 ? 'bg-transparent' : (isCompleted(stage) ? 'bg-(--ui-primary)' : 'bg-(--ui-border)')"
        />
      </div>

      <!-- 标签 -->
      <div class="text-center px-1">
        <p
          class="text-xs font-medium"
          :class="isActive(stage) ? 'text-(--ui-primary)' : 'text-(--ui-text)'"
        >
          {{ getStageInfo(stage).title }}
        </p>
        <p class="text-xs text-(--ui-text-dimmed) mt-0.5 line-clamp-1">
          {{ getStageInfo(stage).description }}
        </p>
      </div>
    </div>
  </div>
</template>
