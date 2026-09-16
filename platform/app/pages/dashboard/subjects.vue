<script setup lang="ts">
import SubjectsManager from '../../components/console/SubjectsManager.vue'

definePageMeta({
  layout: 'console'
})

usePageTitle('主体目录')
</script>

<template>
  <SubjectsManager scope="dashboard" />
</template>
