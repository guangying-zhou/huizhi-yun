export default defineAppConfig({
  ui: {
    colors: {
      primary: 'orange',
      secondary: 'blue',
      info: 'gray',
      neutral: 'zinc'
    },
    table: {
      slots: {
        th: 'px-4 py-2',
        td: 'px-2 py-2 font-mono'
      }
    },
    dashboardGroup: {
      base: 'fixed inset-0 flex overflow-hidden bg-default'
    },
    dashboardResizeHandle: {
      base: 'hidden lg:block touch-none select-none cursor-ew-resize relative before:absolute before:inset-y-0 before:-left-1.5 before:-right-1.5 before:z-1 bg-default'
    },
    card: {
      slots: {
        header: 'px-4 sm:py-2',
        footer: 'px-4 py-2',
        body: 'px-4 sm:py-3',
        root: 'px-2',
        title: 'py-2'
      }
    },
    dashboardPanel: {
      slots: {
        root: 'relative flex flex-1 min-w-0 min-h-0 h-full flex-col overflow-hidden shrink-0',
        body: 'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:gap-6 sm:p-6'
      }
    }
  }
})
