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
    card: {
      slots: {
        header: 'px-4 sm:py-2',
        footer: 'px-4 py-2',
        body: 'px-4 sm:py-3',
        root: 'px-2',
        title: 'py-2'
      }
    }
  }
})
