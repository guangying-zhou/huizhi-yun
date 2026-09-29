<script setup lang="ts">
import type { ConsoleDirectoryUser } from '../types/consoleDirectory'

const props = defineProps<{ user: ConsoleDirectoryUser }>()
const fields = computed(() => [
  { label: '用户编码', value: props.user.uid },
  { label: '用户名', value: props.user.username },
  { label: '姓名', value: props.user.realName || props.user.displayName },
  { label: '昵称', value: props.user.nickname },
  { label: '邮箱', value: props.user.email },
  { label: '手机尾号', value: props.user.mobileTail4 },
  { label: '主部门', value: props.user.deptName || props.user.deptCode },
  { label: '职位', value: props.user.positionTitle },
  { label: '类型', value: props.user.userType }
])
</script>

<template>
  <dl class="space-y-3">
    <div v-for="field in fields" :key="field.label" class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 text-sm">
      <dt class="text-muted">
        {{ field.label }}
      </dt>
      <dd class="break-words">
        {{ field.value || '—' }}
      </dd>
    </div>
  </dl>
</template>
