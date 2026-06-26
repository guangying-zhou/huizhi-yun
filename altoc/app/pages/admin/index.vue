<script setup lang="ts">
</script>

<template>
  <UDashboardPanel id="admin">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          系统管理
        </h1>
      </Teleport>

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
