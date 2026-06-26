<script setup lang="ts">
definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '系统管理',
  layoutHeaderProjectSwitcher: false
})
</script>

<template>
  <UDashboardPanel id="admin">
    <template #body>
      <div class="grid gap-4 md:grid-cols-2">
        <UCard>
          <template #header>
            <span class="font-semibold">系统管理</span>
          </template>
          <div class="space-y-3 p-2 text-sm">
            <p>此页面仅对拥有管理员权限的用户可见。</p>
            <UButton
              label="项目管理"
              color="primary"
              variant="soft"
              to="/admin/projects"
            />
            <UButton
              label="产品管理"
              color="primary"
              variant="soft"
              to="/admin/products"
            />
            <UButton
              label="项目模板版本"
              color="primary"
              variant="soft"
              to="/admin/project-templates"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
