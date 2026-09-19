export default function OSS(): never {
  throw new Error('Native OSS provider is unavailable in Enterprise Cloudflare builds; use the configured Console integration adapter')
}
