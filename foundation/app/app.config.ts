export default defineAppConfig({
  ui: {
    dashboardSidebar: {
      slots: {
        // 默认 lg 断点改为 sm（640px）：< 640px 抽屉模式，>= 640px 侧边栏模式
        root: 'relative hidden sm:flex flex-col min-h-svh min-w-16 w-(--width) shrink-0',
        content: 'sm:hidden',
        overlay: 'sm:hidden'
      }
    },
    dashboardSidebarToggle: {
      // 汉堡图标只在 < 640px 时显示
      base: 'sm:hidden'
    }
  }
})
