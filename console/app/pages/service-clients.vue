<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('服务凭证')
</script>

<template>
  <UDashboardPanel id="service-clients" :ui="dashboardPanelUi">
    <template #header>
      <UDashboardNavbar title="服务凭证">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UCard>
        <template #header>
          <span class="font-semibold">Service Clients</span>
        </template>
        <p class="text-sm text-muted">
          这里将管理本地 service client、client secret 轮换、访问授权和最近使用情况。
        </p>
      </UCard>
    </template>
  </UDashboardPanel>
</template>
