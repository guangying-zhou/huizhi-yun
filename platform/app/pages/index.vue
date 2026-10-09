<script setup lang="ts">
definePageMeta({
  layout: 'public'
})

usePageTitle('汇智云平台')

const capabilityGroups = [
  {
    title: '统一身份与授权',
    description: '将登录、主体目录、角色模板、scope、授权快照收口到一个控制面。'
  },
  {
    title: '租户级应用治理',
    description: '让每个租户在自己的 dashboard 中配置角色、模板、主体和应用启用状态。'
  },
  {
    title: '平台级部署与许可证',
    description: '由平台控制租户开通、deployment、bundle、heartbeat 和 license 生命周期。'
  }
]
</script>

<template>
  <section class="mx-auto flex max-w-7xl flex-col gap-16 px-6 py-16 lg:px-10 lg:py-20">
    <div class="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
      <div class="space-y-6">
        <!-- <div class="flex flex-wrap items-center gap-2">
          <UBadge
            color="primary"
            variant="soft"
          >
            New SaaS Control Plane
          </UBadge>
          <UBadge
            v-for="item in highlights"
            :key="item"
            color="neutral"
            variant="soft"
          >
            {{ item }}
          </UBadge>
        </div> -->

        <div class="space-y-4">
          <p class="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">
            Huizhi-yun Platform
          </p>
          <h1 class="max-w-4xl text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
            企业智能协同平台
          </h1>
          <p class="max-w-3xl text-lg leading-8 text-slate-600">
            汇智云企业智能协同平台提供AI驱动的一站式智能协同办公、Markdown优先的协同文档、深度融合的软件研发项目管理、全面资产管理、线索到现金全生命周期营销管理以及全方位企业经营洞察能力。平台秉持以用户为中心的设计理念，采用由用户自行托管全部数据与应用的模式，彻底解除数据主权担忧、确保数据安全。
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <!-- <UButton
            color="primary"
            size="xl"
            to="/dashboard/register"
          >
            申请试用
          </UButton> -->
          <UButton
            color="primary"
            variant="ghost"
            size="xl"
            to="/admin"
          >
            平台控制台Admin
          </UButton>
          <UButton
            color="primary"
            variant="ghost"
            size="xl"
            to="/dashboard"
          >
            租户控制台Dashboard
          </UButton>
        </div>
      </div>

      <div class="rounded-[2rem] border border-sky-100 bg-white/85 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur">
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p class="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              Platform Admin
            </p>
            <p class="mt-3 text-lg font-semibold text-slate-900">
              /admin
            </p>
            <p class="mt-2 text-sm leading-6 text-slate-600">
              跨租户控制台，负责租户、deployment、license、manifest 与系统级治理。
            </p>
          </div>
          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p class="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              Tenant Dashboard
            </p>
            <p class="mt-3 text-lg font-semibold text-slate-900">
              /dashboard
            </p>
            <p class="mt-2 text-sm leading-6 text-slate-600">
              面向租户管理员，负责本租户用户、主体、角色、模板和应用配置。
            </p>
          </div>
        </div>
      </div>
    </div>

    <section class="grid gap-4 lg:grid-cols-3">
      <UCard
        v-for="group in capabilityGroups"
        :key="group.title"
      >
        <template #header>
          <div class="space-y-2">
            <p class="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">
              Capability
            </p>
            <h2 class="text-lg font-semibold text-slate-900">
              {{ group.title }}
            </h2>
          </div>
        </template>

        <p class="text-sm leading-7 text-slate-600">
          {{ group.description }}
        </p>
      </UCard>
    </section>
  </section>
</template>
