<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('企业资料')

const sections = [
  '基础资料',
  '业务域',
  '区域与行政区划映射'
]
</script>

<template>
  <UDashboardPanel id="org-profile" :ui="dashboardPanelUi">
    <template #body>
      <div class="grid gap-3 lg:grid-cols-3">
        <UCard v-for="section in sections" :key="section">
          <template #header>
            <span class="font-semibold">{{ section }}</span>
          </template>
          <p class="text-sm text-muted">
            待接入 org-profile API 后提供编辑与查看能力。
          </p>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
