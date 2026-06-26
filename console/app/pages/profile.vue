<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('个人资料')

const { user: authUser, userEmail, userRealname, userDepartment, userDeptCode } = useAuth()
</script>

<template>
  <UDashboardPanel id="workspace-profile" :ui="dashboardPanelUi">
    <template #body>
      <div class="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <section class="border-b border-default pb-4">
          <p class="text-sm text-muted">
            工作台
          </p>
          <h2 class="mt-1 text-2xl font-semibold text-highlighted">
            个人资料
          </h2>
        </section>

        <UCard>
          <template #header>
            <span class="font-semibold">个人信息</span>
          </template>

          <div class="grid gap-4 sm:grid-cols-2">
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
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
