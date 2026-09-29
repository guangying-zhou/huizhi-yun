<script setup lang="ts">
import NotificationCenter from '../../../../foundation/app/components/NotificationCenter.vue'
import { dashboardPanelUi } from '../../utils/dashboardPanel'

const detailPath = (id: string) => `/notifications/${encodeURIComponent(id)}`
const route = useRoute()
const notificationId = computed(() => String(
  Array.isArray(route.params.notificationId)
    ? route.params.notificationId[0]
    : route.params.notificationId || ''
).trim())
</script>

<template>
  <NotificationCenter
    :notification-id="notificationId"
    list-path="/notifications"
    :detail-path="detailPath"
    :panel-ui="dashboardPanelUi"
  />
</template>
