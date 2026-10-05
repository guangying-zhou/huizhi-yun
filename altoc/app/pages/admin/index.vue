<script setup lang="ts">
usePageTitle('系统管理')
</script>

<template>
  <UDashboardPanel id="admin">
    <template #body>
      <UCard>
        <template #header>
          <span class="font-semibold">系统管理</span>
        </template>
        <div class="text-sm p-2">
          <p>此页面仅对拥有管理员权限的用户可见。</p>
        </div>
      </UCard>
    </template>
  </UDashboardPanel>
</template>
