<script setup lang="ts">
const route = useRoute()
const notificationId = computed(() => String(
  Array.isArray(route.params.notificationId)
    ? route.params.notificationId[0]
    : route.params.notificationId || ''
).trim())
</script>

<template>
  <NotificationCenter :notification-id="notificationId" />
</template>
