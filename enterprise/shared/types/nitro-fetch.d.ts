import 'nitropack/types'

// Reuse the installed opt-in patch used by Aims for large composed route sets.
// Literal response inference and METHOD checks stay intact; generic request
// autocomplete no longer expands every route (see docs/API_SPEC.md).
declare module 'nitropack/types' {
  interface NitroFetchConfig {
    flatRequest: true
  }
}
