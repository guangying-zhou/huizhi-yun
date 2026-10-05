// 安装全局 console / 错误捕获，供 IssueReporter 采集最近的控制台错误
export default defineNuxtPlugin(() => {
  installIssueConsoleCapture()
})
