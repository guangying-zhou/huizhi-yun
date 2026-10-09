/**
 * 随机封面图
 * GET /api/covers → 302 重定向到 OSS 上的随机封面图片
 *
 * 图片存储在 OSS images bucket 的 slide_covers/ 目录下
 */

const COVERS_BASE = 'https://images.wiztek.cn/slide_covers'

const COVER_FILES = [
  '_0p_9gryfNo.webp',
  '_eObctVlXn4.webp',
  '3GmudSL84n4.webp',
  '3XXSKa4jKaM.webp',
  '4uH95YbrT0c.webp',
  '6terqWC_KCk.webp',
  'ahX1sknMGhg.webp',
  'aQcE3gDSSTY.webp',
  'AydfIofZXNY.webp',
  'CmSb2HIPNyg.webp',
  'd34DtRp1bqo.webp',
  'dijDmGXAiFY.webp',
  'fVBWN3_ST0E.webp',
  'FwjWUGbrxOU.webp',
  'gKmpcDQWPmY.webp',
  'j0_bhuZTYH0.webp',
  'jtsW--Z6bFw.webp',
  'kZy1nlnf9Z8.webp',
  'Mg5vq_DlqqU.webp',
  'mYBMP8pW4uQ.webp',
  'NgzaXnY9hF0.webp',
  'PFxSKx4kc5U.webp',
  'Ppi1PWgiJu4.webp',
  'rRpZIM_IJmc.webp',
  'SHE_ZiroE0g.webp',
  'tZr3_JuURZA.webp',
  'X1exjxxBho4.webp',
  'XdcRfXL2hJ4.webp',
  'zRkBOOpKRhs.webp'
]

export default defineEventHandler((event) => {
  const file = COVER_FILES[Math.floor(Math.random() * COVER_FILES.length)]
  return sendRedirect(event, `${COVERS_BASE}/${file}`)
})
