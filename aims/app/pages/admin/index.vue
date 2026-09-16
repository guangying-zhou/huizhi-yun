<script setup lang="ts">
definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '系统管理',
  layoutHeaderProjectSwitcher: false
})

const { hasPermission } = usePermissions()

const canManageProjects = computed(() => hasPermission('projects', 'admin') || hasPermission('admin', 'admin'))
const canManageProducts = computed(() => hasPermission('admin', 'admin'))
const canManageTemplates = computed(() => hasPermission('project_templates', 'admin') || hasPermission('admin', 'admin'))
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
            <p>这里显示你有权管理的 AIMS 配置。</p>
            <UButton
              v-if="canManageProjects"
              label="项目管理"
              color="primary"
              variant="soft"
              to="/admin/projects"
            />
            <UButton
              v-if="canManageProducts"
              label="产品管理"
              color="primary"
              variant="soft"
              to="/admin/products"
            />
            <UButton
              v-if="canManageTemplates"
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
