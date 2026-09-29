<script setup lang="ts">
definePageMeta({ hostContentInset: false, name: 'console-host-todos', navigationOwner: 'console' })
</script>

<template>
  <TodoList
    server-pagination
    hosted
    api-path="/enterprise/api/notifications/todos"
    :panel-ui="{ root: '!min-h-0 !h-full', body: '!p-4 sm:!p-6' }"
  />
</template>
