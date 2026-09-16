// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    'vue/no-multiple-template-root': 'off',
    'vue/max-attributes-per-line': ['error', { singleline: 3 }],
    // Project formatting conventions
    'quotes': ['error', 'single', { avoidEscape: true }],
    'semi': ['error', 'never'],
    'comma-dangle': ['error', 'never'],
    // Operators should be placed at the end of the line for multi-line expressions (project default)
    'operator-linebreak': ['error', 'before'],
    // Altoc still has legacy dynamic tenant-runtime CRUD pages; keep typecheck strict
    // while allowing explicit dynamic payloads until those pages are fully modeled.
    '@typescript-eslint/no-explicit-any': 'off'
  }
})
