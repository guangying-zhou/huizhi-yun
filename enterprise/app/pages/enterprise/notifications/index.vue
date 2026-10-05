<script setup lang="ts">
definePageMeta({ hostContentInset: false, name: 'console-host-notifications', navigationOwner: 'console' })

const detailPath = (id: string) => `/enterprise/notifications/${encodeURIComponent(id)}`
</script>

<template>
  <NotificationCenter
    hosted
    server-pagination
    list-path="/enterprise/notifications"
    :detail-path="detailPath"
    :panel-ui="{ root: '!min-h-0 !h-full', body: '!p-4 sm:!p-6' }"
  />
</template>
