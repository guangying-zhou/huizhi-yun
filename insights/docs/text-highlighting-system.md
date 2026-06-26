# Text Highlighting System Documentation

## Overview

The text highlighting system allows users to easily emphasize important words in content using a familiar Markdown-style syntax (`**text**`) instead of complex technical markup (`[text]{.text-primary}`).

## Architecture

### Core Components

#### 1. TextHighlightProcessor (`app/utils/textHighlight.ts`)

The main utility class handling bidirectional syntax conversion:

```typescript
export class TextHighlightProcessor {
  // Convert technical syntax to user-friendly syntax for editing
  static processForEditor(rawText: string): string

  // Convert user syntax to technical syntax for storage
  static processForSaving(userText: string): string

  // Convert user syntax to HTML for preview
  static processForPreview(userText: string): string

  // Validate user syntax
  static validateSyntax(userText: string): ValidationResult
}
```

**Conversion Examples:**
- Input: `**Revolutionize** your business`
- Storage: `[Revolutionize]{.text-primary} your business`
- Display: `<span class="text-primary">Revolutionize</span> your business`

#### 2. HighlightTextInput Component (`app/components/ui/HighlightTextInput.vue`)

Reusable Vue component providing a unified interface for text highlighting:

**Props:**
- `modelValue: string` - The text content
- `placeholder?: string` - Input placeholder
- `label?: string` - Input label
- `help?: string` - Help text displayed below input
- `disabled?: boolean` - Disable input
- `rows?: number` - Number of rows (removed in favor of single-line UInput)

**Features:**
- Automatic syntax conversion
- Real-time validation
- Help text guidance
- Error display
- Consistent styling with existing UI

#### 3. MDC Parser Enhancement (`app/utils/mdcParser.ts`)

Added `cleanMDCText()` function to remove technical markup from page titles:

```typescript
// Clean: "[Revolutionize]{.text-primary} your business" → "Revolutionize your business"
export function cleanMDCText(text: string): string
```

## Implementation Details

### Data Flow

```mermaid
graph LR
    A[User Input: **text**] --> B[HighlightTextInput]
    B --> C[processForSaving]
    C --> D[Storage: [text]{.text-primary}]
    D --> E[R2 Database]
    E --> F[Page Load]
    F --> G[processForEditor]
    G --> H[Display: **text**]

    D --> I[Page Render]
    I --> J[mdcParser]
    J --> K[HTML: <span class="text-primary">text</span>]

    D --> L[Page Title]
    L --> M[cleanMDCText]
    M --> N[Clean Title: text]
```

### Supported Components

All content property components have been updated to support text highlighting:

| Component                       | Highlighted Fields                                  | Status |
| ------------------------------- | --------------------------------------------------- | ------ |
| `SectionHeroProperties`         | Page Title                                          | ✅      |
| `SectionAboutProperties`        | Section Title, Feature Titles, Feature Descriptions | ✅      |
| `SectionFeaturesProperties`     | Section Title                                       | ✅      |
| `SectionPricingProperties`      | Section Title                                       | ✅      |
| `SectionStepsProperties`        | Section Title, Step Titles                          | ✅      |
| `SectionCtaProperties`          | Section Title                                       | ✅      |
| `SectionTestimonialsProperties` | Section Title                                       | ✅      |

### Update Pattern

Each component follows this pattern:

1. **Import dependencies:**
   ```typescript
   import { TextHighlightProcessor } from '~/utils/textHighlight'
   import HighlightTextInput from '~/components/ui/HighlightTextInput.vue'
   ```

2. **Replace UInput/UTextarea with HighlightTextInput for title fields:**
   ```vue
   <HighlightTextInput
     v-model="localData.title"
     help="Use **keywords** to highlight important words in primary color"
     placeholder="Enter title, use **text** to highlight"
   />
   ```

3. **Update data processing in updateData():**
   ```typescript
   const updateData = {
     title: TextHighlightProcessor.processForSaving(localData.value.title),
     description: localData.value.description, // No conversion for description
     // ... other fields
   }
   ```

### Page Title Cleanup

Three main pages have been updated to clean titles for SEO meta tags:

1. **`app/pages/index.vue`**
2. **`app/pages/[business]/index.vue`**
3. **`app/pages/[business]/pricing.vue`**

Pattern:
```typescript
import { cleanMDCText } from '~/utils/mdcParser'

const cleanTitle = computed(() => {
  return cleanMDCText(page.value?.title || 'Default Title')
})

useSeoMeta({
  title: cleanTitle,
  ogTitle: cleanTitle,
  // ...
})
```

## Usage Guidelines

### For Users

Users can now highlight important text using familiar Markdown syntax:

- ✅ **Correct**: `Welcome to **RepoInsight** platform`
- ❌ **Old way**: `Welcome to [RepoInsight]{.text-primary} platform`

### For Developers

#### Adding Text Highlighting to New Components

1. Import required utilities:
   ```typescript
   import { TextHighlightProcessor } from '~/utils/textHighlight'
   import HighlightTextInput from '~/components/ui/HighlightTextInput.vue'
   ```

2. Use HighlightTextInput for title fields:
   ```vue
   <HighlightTextInput
     v-model="localData.title"
     help="Use **keywords** to highlight important words"
     placeholder="Enter title, use **text** to highlight"
   />
   ```

3. Process data on save:
   ```typescript
   const processedData = {
     title: TextHighlightProcessor.processForSaving(localData.value.title)
   }
   ```

#### Validation and Error Handling

The system includes built-in validation:

```typescript
const validation = TextHighlightProcessor.validateSyntax(userText)
if (!validation.valid) {
  // Display validation.errors to user
}
```

## Performance Considerations

- **Debounced Updates**: 300ms delay prevents excessive API calls
- **Lazy Processing**: Conversion only happens when needed
- **Memory Efficient**: No persistent storage of converted text
- **SSR Compatible**: Uses ClientOnly wrapper where needed

## Browser Compatibility

The text highlighting system works with all modern browsers and is compatible with:
- Server-side rendering (SSR)
- Static site generation
- Client-side hydration

## Testing

### Manual Testing Checklist

- [ ] User can input `**text**` syntax
- [ ] Text highlights correctly in preview
- [ ] Data saves with technical format
- [ ] Page titles display clean text
- [ ] All section editors support highlighting
- [ ] Validation shows appropriate errors
- [ ] Help text displays correctly

### Edge Cases Handled

- Empty or null text input
- Malformed syntax (missing closing `**`)
- Nested highlighting attempts
- Special characters in highlighted text
- Very long highlighted text

## Future Enhancements

Potential improvements for future versions:

1. **Multiple Highlight Colors**: Support for different highlight styles
2. **Keyboard Shortcuts**: Quick formatting shortcuts
3. **Bulk Operations**: Convert existing content in batch
4. **Advanced Validation**: More detailed syntax checking
5. **Performance Monitoring**: Track conversion performance

## Troubleshooting

### Common Issues

1. **Hydration Mismatches**: Use `ClientOnly` wrapper for SSR compatibility
2. **Text Not Highlighting**: Check CSS classes and theme configuration
3. **Validation Errors**: Ensure proper `**` syntax pairing
4. **Page Title Issues**: Verify `cleanMDCText` is applied to SEO meta tags

### Debug Tools

Enable debug logging by checking browser console for:
- `🔄 Props data sync from R2 with syntax conversion`
- `⭐ Update event with syntax conversion`
- Validation error messages

---

*Last updated: January 2025*
*Implementation completed in commit: `c470ad9`*