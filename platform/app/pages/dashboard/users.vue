<script setup lang="ts">
import UsersManager from '../../components/console/UsersManager.vue'

definePageMeta({
  layout: 'console'
})

usePageTitle('用户管理')
</script>

<template>
  <UsersManager scope="dashboard" />
</template>
