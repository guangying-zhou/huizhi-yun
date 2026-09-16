import { joinURL } from 'ufo'

interface OpenAPIInfo {
  title?: string
  version?: string
  description?: string
}

interface OpenAPIDocument {
  openapi: string
  info?: OpenAPIInfo
  servers?: Array<Record<string, unknown>>
  paths?: Record<string, unknown>
  components?: Record<string, unknown>
  tags?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export async function fetchInternalOpenAPIDocument(event: Parameters<typeof getRequestURL>[0]) {
  const origin = getRequestURL(event).origin
  return await $fetch<OpenAPIDocument>(joinURL(origin, '/_nitro/__openapi.json'))
}

export async function getV1OpenAPIDocument(event: Parameters<typeof getRequestURL>[0]) {
  const doc = await fetchInternalOpenAPIDocument(event)
  const filteredPaths = Object.fromEntries(
    Object.entries(doc.paths || {}).filter(([path]) => path.startsWith('/api/v1/'))
  )

  return {
    ...doc,
    info: {
      ...doc.info,
      description: [
        doc.info?.description,
        '当前文档仅展示 /api/v1/** 接口。'
      ].filter(Boolean).join('\n\n')
    },
    paths: filteredPaths
  }
}

export function getOpenAPIMeta(event: Parameters<typeof getRequestURL>[0]) {
  const runtimeConfig = useRuntimeConfig(event) as {
    nitro?: {
      openAPI?: {
        meta?: OpenAPIInfo
      }
    }
  }

  return {
    title: runtimeConfig.nitro?.openAPI?.meta?.title || 'API Reference',
    description: runtimeConfig.nitro?.openAPI?.meta?.description || ''
  }
}

export function renderScalarHtml(specUrl: string, title: string, description: string) {
  const scalarConfig = {
    url: specUrl,
    spec: {
      url: specUrl
    }
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${description}" />
    <title>${title}</title>
  </head>
  <body>
    <script
      id="api-reference"
      data-configuration="${JSON.stringify(scalarConfig).replaceAll('"', '&quot;')}"
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`
}

export function renderSwaggerHtml(specUrl: string, title: string, description: string) {
  const cdnBase = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@^5'

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${description}" />
    <title>${title}</title>
    <link rel="stylesheet" href="${cdnBase}/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${cdnBase}/swagger-ui-bundle.js" crossorigin></script>
    <script src="${cdnBase}/swagger-ui-standalone-preset.js" crossorigin></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: ${JSON.stringify(specUrl)},
          dom_id: '#swagger-ui',
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIStandalonePreset
          ],
          layout: 'StandaloneLayout'
        })
      }
    </script>
  </body>
</html>`
}
