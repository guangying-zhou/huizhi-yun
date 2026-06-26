export default function OSS(): never {
  throw new Error('ali-oss native provider is not available in People Cloudflare builds; use a Foundation object-storage integration instead')
}
