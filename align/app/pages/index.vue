<script setup lang="ts">
const { user: authUser } = useAuth()
const displayName = computed(() => {
  const realname = useCookie('auth_realname').value
  return realname || authUser.value || '用户'
})
</script>

<template>
  <UDashboardPanel id="home" :ui="{ body: 'sm:gap-3 sm:p-2 m-0' }">
    <template #header>
      <UDashboardNavbar title="汇智云协同" :ui="{ right: 'gap-1' }">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <UColorModeButton />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UCard class="h-full">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold text-lg">欢迎，{{ displayName }}</span>
          </div>
        </template>
        <div class="text-sm p-2 space-y-3">
          <p>`Align` 是汇智云面向组织协同的业务模块，当前脚手架已完成，后续会围绕 `Aims` 试点场景逐步补齐协同能力。</p>
          <ul class="list-disc pl-5 space-y-1">
            <li>跨部门事项协助</li>
            <li>人员借调与组织协同</li>
            <li>通知待办与办公协作</li>
            <li>后续承接 HR 轻流程与轻财务流程</li>
            <li>复用 Account、Workflow 与 Foundation 的平台能力</li>
          </ul>
        </div>
      </UCard>
    </template>
  </UDashboardPanel>
</template>
