<script setup lang="ts">
import type { ConsoleDirectorySelfProfile } from '../types/consoleDirectory'

const props = defineProps<{ profile: ConsoleDirectorySelfProfile }>()
const fields = computed(() => [
  ['UID', props.profile.uid], ['用户名', props.profile.username || props.profile.uid],
  ['真实姓名', props.profile.realName || props.profile.displayName], ['昵称', props.profile.nickname],
  ['邮箱', props.profile.email], ['部门', props.profile.deptName], ['部门编码', props.profile.deptCode],
  ['岗位', props.profile.positionTitle], ['用户类型', props.profile.userType], ['手机尾号', props.profile.mobileTail4]
])
</script>

<template>
  <dl class="self-profile-details">
    <div v-for="[label, value] in fields" :key="label || ''" class="min-w-0">
      <dt class="text-sm font-medium text-muted">
        {{ label }}
      </dt>
      <dd class="mt-1 break-words text-sm">
        {{ value || '—' }}
      </dd>
    </div>
  </dl>
</template>

<style scoped>
.self-profile-details { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
@media (min-width: 640px) { .self-profile-details { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
