export default defineAppConfig({
  ui: {
    colors: {
      primary: 'orange',
      secondary: 'blue',
      info: 'gray',
      neutral: 'zinc'
    },
    dashboardNavbar: {
      slots: {
        title: 'pr-4'
      }
    },
    dashboardGroup: {
      base: 'fixed inset-0 flex overflow-hidden bg-default'
    },
    dashboardPanel: {
      slots: {
        root: 'min-h-95/100',
        body: 'p-4 overflow-auto'
      }
    },
    dashboardResizeHandle: {
      base: 'hidden lg:block touch-none select-none cursor-ew-resize relative before:absolute before:inset-y-0 before:-left-1.5 before:-right-1.5 before:z-1 bg-default'
    },
    table: {
      slots: {
        th: 'px-6 py-2',
        td: 'px-4 py-2 font-mono'
      }
    },
    modal: {
      slots: {
        content: 'sm:max-w-3xl',
        footer: 'flex items-center justify-end gap-4 px-4 py-4'
      }
    },
    card: {
      slots: {
        header: 'px-4 sm:py-2',
        footer: 'px-4 py-2',
        body: 'px-4 sm:py-3',
        root: 'bg-default border border-gray-200 dark:border-gray-700 divide-y divide-default rounded-lg overflow-hidden px-2',
        title: 'py-2'
      }
    }
  }
})
