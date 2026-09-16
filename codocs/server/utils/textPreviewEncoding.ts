import iconv from 'iconv-lite'

export interface TextPreviewDecodeResult {
  content: string
  encoding: string
}

const MOJIBAKE_PATTERNS = [
  '锟斤拷',
  '锟',
  '涓',
  '绛',
  '鐨',
  '杩',
  '鏂',
  '鎴',
  '妯',
  '犲',
  '勾',
  '浜',
  '浠',
  '淇',
  '悆',
  '夋',
  '€',
  'Ã',
  'Â',
  'â'
]

function decodeUtf8Strict(buffer: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return null
  }
}

function decodeWithIconv(buffer: Buffer, encoding: string) {
  return iconv.decode(buffer, encoding)
}

function replacementCount(text: string) {
  return text.match(/\uFFFD/g)?.length || 0
}

function controlCount(text: string) {
  let count = 0
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code < 32 && char !== '\n' && char !== '\r' && char !== '\t') {
      count++
    }
  }
  return count
}

function mojibakeCount(text: string) {
  return MOJIBAKE_PATTERNS.reduce((count, pattern) => {
    return count + (text.split(pattern).length - 1)
  }, 0)
}

function cjkCount(text: string) {
  return text.match(/[\u3400-\u9fff]/g)?.length || 0
}

function textScore(text: string) {
  return replacementCount(text) * 100
    + controlCount(text) * 20
    + mojibakeCount(text) * 12
}

function stripUtf8Bom(buffer: Buffer) {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
    ? buffer.subarray(3)
    : buffer
}

export function decodeTextPreviewBuffer(buffer: Buffer): TextPreviewDecodeResult {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return {
      content: decodeWithIconv(buffer.subarray(2), 'utf16-le'),
      encoding: 'utf-16le'
    }
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return {
      content: decodeWithIconv(buffer.subarray(2), 'utf16-be'),
      encoding: 'utf-16be'
    }
  }

  const source = stripUtf8Bom(buffer)
  const utf8Text = decodeUtf8Strict(source)
  if (utf8Text === null) {
    return {
      content: decodeWithIconv(source, 'gb18030'),
      encoding: 'gb18030'
    }
  }

  const gb18030Text = decodeWithIconv(source, 'gb18030')
  const utf8Score = textScore(utf8Text)
  const gb18030Score = textScore(gb18030Text)
  const gb18030HasUsefulCjk = cjkCount(gb18030Text) > cjkCount(utf8Text)

  if (gb18030Score + (gb18030HasUsefulCjk ? 6 : 0) < utf8Score) {
    return {
      content: gb18030Text,
      encoding: 'gb18030'
    }
  }

  return {
    content: utf8Text,
    encoding: 'utf-8'
  }
}
