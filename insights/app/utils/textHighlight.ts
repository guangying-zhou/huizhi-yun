/**
 * Text highlight markup conversion utilities
 * Convert between user-friendly syntax and technical syntax
 */

/**
 * Convert user-friendly double asterisk syntax to technical syntax
 * **text** -> [text]{.text-primary}
 */
export function convertUserSyntaxToTechnical(text: string): string {
  if (!text) return text

  // Match **content** format
  return text.replace(/\*\*(.*?)\*\*/g, '[$1]{.text-primary}')
}

/**
 * Convert technical syntax to user-friendly double asterisk syntax
 * [text]{.text-primary} -> **text**
 */
export function convertTechnicalToUserSyntax(text: string): string {
  if (!text) return text

  // Match [content]{.text-primary} format
  return text.replace(/\[(.*?)\]\{\.text-primary\}/g, '**$1**')
}

/**
 * Convert highlight syntax for preview rendering
 * **text** -> <span class="text-primary">text</span>
 */
export function convertToHtml(text: string): string {
  if (!text) return text

  // First convert to technical syntax, then convert to HTML
  const technicalSyntax = convertUserSyntaxToTechnical(text)

  // Match [content]{.text-primary} and convert to HTML
  return technicalSyntax.replace(
    /\[(.*?)\]\{\.text-primary\}/g,
    '<span class="text-primary font-semibold">$1</span>'
  )
}

/**
 * Text highlight processor class
 */
export class TextHighlightProcessor {
  /**
   * Process for editor input - display user-friendly syntax
   */
  static processForEditor(rawText: string): string {
    if (!rawText) return ''

    return convertTechnicalToUserSyntax(rawText)
  }

  /**
   * Process for saving data - convert to technical syntax
   */
  static processForSaving(userText: string): string {
    return convertUserSyntaxToTechnical(userText)
  }

  /**
   * Process for preview display - convert to HTML
   */
  static processForPreview(userText: string): string {
    return convertToHtml(userText)
  }

  /**
   * Validate syntax correctness
   */
  static validateSyntax(text: string): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // Check for unmatched double asterisks
    const asteriskMatches = text.match(/\*\*/g)
    if (asteriskMatches && asteriskMatches.length % 2 !== 0) {
      errors.push('Highlight markup is incomplete, please ensure each ** has a corresponding closing mark')
    }

    // Check for nested highlight marks
    if (/\*\*.*\*\*.*\*\*/.test(text)) {
      errors.push('Nested highlight marks are not supported')
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }
}