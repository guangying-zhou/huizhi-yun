<script setup lang="ts">
import NotificationCenter from '../../../../foundation/app/components/NotificationCenter.vue'
import { dashboardPanelUi } from '../../utils/dashboardPanel'

const detailPath = (notificationId: string) => `/notifications/${encodeURIComponent(notificationId)}`
</script>

<template>
  <NotificationCenter list-path="/notifications" :detail-path="detailPath" :panel-ui="dashboardPanelUi" />
</template>
