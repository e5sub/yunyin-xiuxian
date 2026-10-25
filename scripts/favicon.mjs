/**
 * favicon 生成:从 128 母图缩出 16/32/48 三个条目,装成一枚 .ico
 *
 * 用法: bun run build:favicon(读 images/brand/favicon-source-128.png)
 * 母图放 images/brand/(不进产物):public/ 下的都会被打包发出去。与 PWA 安装图标 public/icons/icon-512.png 不是同一张画。
 * 换画只换母图重跑,不手改 .ico;判据见 src/ui/favicon.spec.ts(条目只许 16/32/48,体积不许超预算)。
 * 不引图像库(仓里没有 sharp / jimp / PIL):缩图与 PNG 编码用 Playwright 的 Chromium canvas。
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'images/brand/favicon-source-128.png')
const OUT = join(ROOT, 'public/favicon.ico')
/** 标签页 16、高分屏 32、桌面「大图标」48;更大没有调用方 */
const SIZES = [16, 32, 48]

/** 装 ICO:6 字节目录头 + 每张 16 字节目录项 + 数据块;宽高字段 1 字节,0 代表 256;数据块直接用 PNG(Vista 之后都认) */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  let offset = 6 + images.length * 16
  const entries = []
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2) // 调色板色数:0 = 真彩
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bpp
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += png.length
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
}

const source = readFileSync(SOURCE).toString('base64')
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const images = await page.evaluate(
    async ({ src, sizes }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${src}`
      await img.decode()
      const out = []
      for (const size of sizes) {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, size, size)
        const dataUrl = canvas.toDataURL('image/png')
        out.push({ size, b64: dataUrl.slice(dataUrl.indexOf(',') + 1) })
      }
      return out
    },
    { src: source, sizes: SIZES }
  )
  const ico = buildIco(images.map((i) => ({ size: i.size, png: Buffer.from(i.b64, 'base64') })))
  writeFileSync(OUT, ico)
  for (const i of images) {
    console.log(`  ${i.size}×${i.size}  ${Buffer.from(i.b64, 'base64').length} B`)
  }
  console.log(`✓ favicon.ico  ${ico.length} B  ← ${SIZES.join(' / ')}`)
} finally {
  await browser.close()
}
