import { defineEventHandler } from 'h3'

// Host API prefixes are physical registered routes. The Foundation standalone
// base-path compatibility rewrite must not strip a module prefix, especially
// from a browser-supplied x-forwarded-prefix header.
export default defineEventHandler(() => {})
