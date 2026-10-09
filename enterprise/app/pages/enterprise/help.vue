<script setup lang="ts">
import { employeeGuide } from '../../../../console/shared/employeeGuide'

definePageMeta({ name: 'console-host-help', navigationOwner: 'console' })
</script>

<template>
  <div class="mx-auto w-full max-w-4xl p-4 sm:p-6">
    <SafeMarkdown :content="employeeGuide" />
  </div>
</template>
