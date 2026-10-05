import 'nitropack/types'

// See patches/nitropack@2.13.4.patch and docs/Aims-Nitro-Fetch-Types.md.
// Literal URLs still infer their response and allowed methods. Only the generic
// request-key autocomplete union is omitted for this large API surface.
declare module 'nitropack/types' {
  interface NitroFetchConfig {
    flatRequest: true
  }
}
