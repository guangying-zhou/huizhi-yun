<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{
  error: NuxtError
}>()

const config = useRuntimeConfig()
const appBaseURL = String(config.app?.baseURL || '/')
const logoPath = `${appBaseURL}brand/hzy-logo.png`.replace(/\/{2,}/g, '/')
const notFoundIllustrationPath = `${appBaseURL}illustrations/404.svg`.replace(/\/{2,}/g, '/')
const statusCode = computed(() => Number(props.error.statusCode || 500))
const isNotFound = computed(() => statusCode.value === 404)

useSeoMeta({
  title: () => isNotFound.value ? '页面走丢了 · 汇智云数智协同平台' : '出现错误 · 汇智云数智协同平台',
  description: () => isNotFound.value
    ? '您访问的页面不存在或已被移除。'
    : '页面暂时无法访问，请稍后重试。'
})

useHead({
  htmlAttrs: {
    lang: 'zh-CN'
  }
})

async function returnToWorkbench() {
  await clearError({ redirect: '/' })
}

async function returnToPreviousPage() {
  if (window.history.length > 1) {
    window.history.back()
    return
  }
  await returnToWorkbench()
}
</script>

<template>
  <UApp>
    <main
      v-if="isNotFound"
      class="not-found-screen"
    >
      <header class="not-found-brand">
        <img
          :src="logoPath"
          alt="汇智云"
          class="not-found-brand__logo"
        >
        <span>汇智云数智协同平台</span>
      </header>

      <section
        class="not-found-content"
        aria-labelledby="not-found-title"
      >
        <img
          :src="notFoundIllustrationPath"
          alt="404 页面不存在"
          class="not-found-illustration"
        >

        <div class="not-found-copy">
          <h1 id="not-found-title">
            页面走丢了
          </h1>
          <p>
            抱歉,您访问的页面不存在或已被移除。<br class="not-found-copy__desktop-break">
            <span class="not-found-copy__detail">请检查网址是否正确,或返回工作台继续协同办公。</span>
          </p>
          <div class="not-found-actions">
            <UButton
              size="xl"
              color="primary"
              class="not-found-action not-found-action--primary"
              @click="returnToWorkbench"
            >
              返回工作台
            </UButton>
            <UButton
              size="xl"
              color="neutral"
              variant="outline"
              class="not-found-action not-found-action--secondary"
              @click="returnToPreviousPage"
            >
              返回上一页
            </UButton>
          </div>
          <p class="not-found-help">
            如需帮助请联系管理员或
            <a
              href="https://www.wiztek.cn/"
              target="_blank"
              rel="noreferrer"
            >
              在线客服
            </a>
          </p>
        </div>
      </section>

      <footer class="not-found-footer">
        © 2026 汇智科技
      </footer>
    </main>

    <UError
      v-else
      :error="error"
    />
  </UApp>
</template>

<style scoped>
.not-found-screen {
  position: relative;
  display: flex;
  min-height: 100dvh;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 88px 40px;
  background: linear-gradient(160deg, #f7f8fa 0%, #eef1f5 55%, #e9f4fb 100%);
  color: #1f2733;
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
}

.not-found-brand {
  position: absolute;
  top: 32px;
  left: 40px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: #1f2733;
  font-size: 17px;
  font-weight: 600;
}

.not-found-brand__logo {
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.not-found-content {
  display: flex;
  align-items: center;
  gap: 96px;
}

.not-found-illustration {
  width: 420px;
  height: 360px;
  flex: 0 0 auto;
  object-fit: contain;
}

.not-found-copy {
  width: 440px;
}

.not-found-copy h1 {
  margin: 0;
  color: #1f2733;
  font-size: 32px;
  font-weight: 700;
  line-height: 1.35;
}

.not-found-copy > p {
  margin: 14px 0 0;
  color: #8a94a3;
  font-size: 16px;
  line-height: 1.8;
}

.not-found-actions {
  display: flex;
  gap: 16px;
  margin-top: 32px;
}

:deep(.not-found-action) {
  min-width: 140px;
  height: 48px;
  justify-content: center;
  border-radius: 10px;
  padding-right: 32px;
  padding-left: 32px;
  font-size: 15px;
}

:deep(.not-found-action--primary) {
  border: 0;
  background: linear-gradient(180deg, #fb8c00, #f57c00);
  box-shadow: 0 6px 16px rgb(245 124 0 / 28%);
  color: #fff;
  font-weight: 600;
}

:deep(.not-found-action--primary:hover) {
  background: linear-gradient(180deg, #f9981e, #e97300);
}

:deep(.not-found-action--secondary) {
  border: 1px solid #e5e9ee;
  background: #fff;
  box-shadow: none;
  color: #3a4656;
  font-weight: 500;
}

:deep(.not-found-action--secondary:hover) {
  border-color: #d8dee6;
  background: #f7f8fa;
}

.not-found-copy .not-found-help {
  margin-top: 28px;
  color: #a7b0bc;
  font-size: 13px;
  line-height: 1.6;
}

.not-found-help a {
  color: #f57c00;
  text-decoration: none;
}

.not-found-help a:hover {
  color: #e65100;
}

.not-found-footer {
  position: absolute;
  right: 0;
  bottom: 28px;
  left: 0;
  color: #a7b0bc;
  font-size: 13px;
  text-align: center;
}

@media (max-width: 767px) {
  .not-found-screen {
    align-items: flex-start;
    padding: 120px 28px 80px;
    background: linear-gradient(170deg, #f7f8fa 0%, #eef1f5 60%, #e9f4fb 100%);
  }

  .not-found-brand {
    display: none;
  }

  .not-found-content {
    width: 100%;
    flex-direction: column;
    gap: 8px;
  }

  .not-found-illustration {
    width: 300px;
    max-width: 100%;
    height: 260px;
  }

  .not-found-copy {
    width: 100%;
    text-align: center;
  }

  .not-found-copy h1 {
    font-size: 22px;
  }

  .not-found-copy > p {
    margin-top: 10px;
    font-size: 14px;
    line-height: 1.7;
  }

  .not-found-copy__desktop-break,
  .not-found-copy__detail,
  .not-found-help {
    display: none;
  }

  .not-found-actions {
    flex-direction: column;
    gap: 14px;
    margin-top: 40px;
  }

  :deep(.not-found-action) {
    width: 100%;
    height: 52px;
    border-radius: 12px;
    font-size: 16px;
  }

  .not-found-footer {
    bottom: 32px;
    font-size: 12px;
  }
}
</style>
