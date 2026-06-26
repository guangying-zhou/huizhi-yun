<script setup lang="ts">
const { user: authUser, userEmail, userRealname, userDepartment, userDeptCode } = useAuth()
</script>

<template>
  <UDashboardPanel id="settings-profile">
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          个人资料
        </h1>
      </Teleport>

      <UCard>
        <template #header>
          <span class="font-semibold">个人信息</span>
        </template>

        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-sm font-medium text-muted">用户名</label>
              <p class="mt-1">
                {{ authUser || '-' }}
              </p>
            </div>
            <div>
              <label class="text-sm font-medium text-muted">真实姓名</label>
              <p class="mt-1">
                {{ userRealname || '-' }}
              </p>
            </div>
            <div>
              <label class="text-sm font-medium text-muted">邮箱</label>
              <p class="mt-1">
                {{ userEmail || '-' }}
              </p>
            </div>
            <div>
              <label class="text-sm font-medium text-muted">部门</label>
              <p class="mt-1">
                {{ userDepartment || '-' }}
              </p>
            </div>
            <div>
              <label class="text-sm font-medium text-muted">部门编码</label>
              <p class="mt-1">
                {{ userDeptCode || '-' }}
              </p>
            </div>
          </div>
        </div>
      </UCard>
    </template>
  </UDashboardPanel>
</template>
