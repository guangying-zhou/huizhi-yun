// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    // Legacy SaaS files — completely ignored
    ignores: [
      'scripts/**',
      'backend/**',
      'docs/FOUC_PREVENTION.md.ts',
      'app/components/App/**',
      'app/components/auth/**',
      'app/components/content/**',
      'app/components/customers/**',
      'app/components/home/**',
      'app/components/inbox/**',
      'app/components/settings/**',
      'app/components/user/**',
      'app/components/BusinessUserMenu.vue',
      'app/components/BusinessesMenu.vue',
      'app/components/DomainManager.vue',
      'app/components/HeroBackground.vue',
      'app/components/MarkdownEditor.vue',
      'app/components/MediaStats.vue',
      'app/components/PromotionalVideo.vue',
      'app/components/R2Home.vue',
      'app/components/StylePresetSelector.vue',
      'app/components/FileUpload.vue',
      'app/components/ImagePlaceholder.vue',
      'app/components/LogoPro.vue',
      'app/components/Isme/**',
      'app/components/Loading/**',
      'app/components/Preview/**',
      'app/components/ui/**',
      'app/plugins/**',
      'app/stores/**',
      'app/types/cms.ts',
      'app/types/index.d.ts',
      'app/utils/urlHelper.ts',
      'app/utils/mdcParser.ts',
      'app/utils/stylePresets.ts',
      'app/utils/textHighlight.ts',
      'types/**'
    ]
  },
  {
    // Relaxed rules for pre-existing repoinsight business components
    files: [
      'app/components/repoinsight/**',
      'app/components/AppLogo.vue',
      'app/components/BackendSetupModal.vue',
      'app/components/DynamicSvg.vue',
      'app/components/UserMenu.vue',
      'app/types/repoinsight.ts',
      'app/composables/usePageLoading.ts',
      'app/composables/useSvgIcon.ts'
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/unified-signatures': 'warn',
      'vue/no-expose-after-await': 'warn',
      'vue/no-unused-vars': 'warn',
      'no-empty': 'warn',
      'no-unexpected-multiline': 'warn',
      '@stylistic/max-statements-per-line': 'warn'
    }
  }
)
