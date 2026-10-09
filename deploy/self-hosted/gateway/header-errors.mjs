export function headerErrorResponse(error) {
  const tooLarge = error?.code === 'HPE_HEADER_OVERFLOW'
  const body = tooLarge
    ? '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>登录需要清理 Cookie - 汇智云</title><h1>无法继续登录</h1><p>请求头过大。请清除本站 Cookie 后重试登录。</p><p>在浏览器的站点设置中清除本站 Cookie，然后重新打开页面。</p></html>'
    : ''
  return `HTTP/1.1 ${tooLarge ? '431 Request Header Fields Too Large' : '400 Bad Request'}\r\nConnection: close\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}
