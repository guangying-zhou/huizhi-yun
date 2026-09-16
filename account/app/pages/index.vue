<script setup lang="ts">
usePageTitle('首页')
</script>

<template>
  <UDashboardPanel id="home" :ui="{ body: 'sm:gap-3 sm:p-2 m-0' }">
    <template #body>
      <UCard class="h-full">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold text-lg">欢迎使用Account</span>
          </div>
        </template>
        <div class="text-sm p-2">
          <p>Account 模块是huizhi-yun 项目中的一个模块，为公司提供用户账号管理功能，为员工提供账号信息管理服务。</p>
        </div>
      </UCard>
    </template>
  </UDashboardPanel>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
