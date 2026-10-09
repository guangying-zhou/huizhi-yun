<script setup lang="ts">
definePageMeta({ hostContentInset: false, name: 'console-host-notifications-notificationId', navigationOwner: 'console' })

const route = useRoute()
const notificationId = computed(() => String(
  Array.isArray(route.params.notificationId)
    ? route.params.notificationId[0]
    : route.params.notificationId || ''
).trim())
const detailPath = (id: string) => `/enterprise/notifications/${encodeURIComponent(id)}`
</script>

<template>
  <NotificationCenter
    hosted
    server-pagination
    :notification-id="notificationId"
    list-path="/enterprise/notifications"
    :detail-path="detailPath"
    :panel-ui="{ root: '!min-h-0 !h-full', body: '!p-4 sm:!p-6' }"
  />
</template>
