import { dataRuntimeReleaseStaticSettings } from '~~/server/utils/dataRuntimeRelease'

export default defineEventHandler((event) => {
  const settings = dataRuntimeReleaseStaticSettings()
  setResponseHeader(event, 'content-type', 'application/x-pem-file; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'public, max-age=300')
  setResponseHeader(event, 'x-hzy-release-signing-key-id', settings.releaseSigningKeyId)
  return settings.releasePublicKeyPem.endsWith('\n')
    ? settings.releasePublicKeyPem
    : `${settings.releasePublicKeyPem}\n`
})
