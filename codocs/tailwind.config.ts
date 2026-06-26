import type { Config } from 'tailwindcss'

export default <Config>{
  safelist: [
    {
      pattern: /(text|bg|ring)-(orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|red|green|blue|yellow|primary|secondary|old-neutral)-(400|500)/
    }
  ]
}
