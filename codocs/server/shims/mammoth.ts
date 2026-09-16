function unsupported(): never {
  throw new Error('DOCX conversion is not supported in the Cloudflare Worker runtime yet')
}

export async function convertToHtml(): Promise<never> {
  unsupported()
}

export default {
  convertToHtml
}
