/**
 * PWA 图标生成:从矢量源 public/icon[-maskable].svg 光栅化出各平台的 PNG。用法: bun run pwa-icons
 * 产物:
 *   public/icons/icon-192.png          web app manifest(常规)
 *   public/icons/icon-512.png          web app manifest(常规)
 *   public/icons/icon-maskable-512.png web app manifest(maskable,全出血+安全区)
 *   public/apple-touch-icon.png        iOS「添加到主屏幕」(180×180,无透明)
 * 光栅化与 PNG 编码用 Playwright 的 Chromium,不引图像库(sharp 不在 package.json)。
 */
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const pub = resolve(here, '../public')
const iconsDir = resolve(pub, 'icons')

await mkdir(iconsDir, { recursive: true })

/** 平铺底色:apple-touch-icon 不许有透明像素(iOS 会把透明处合成黑色) */
const FLATTEN_BG = '#F3EFE4'

const jobs = [
  { src: 'icon.svg', out: 'icons/icon-192.png', size: 192 },
  { src: 'icon.svg', out: 'icons/icon-512.png', size: 512 },
  { src: 'icon-maskable.svg', out: 'icons/icon-maskable-512.png', size: 512 },
  // 用全出血的 maskable 源:常规图标四周留白,做 iOS 桌面图标显小
  { src: 'icon-maskable.svg', out: 'apple-touch-icon.png', size: 180, flatten: FLATTEN_BG }
]

const sources = new Map(
  [...new Set(jobs.map(j => j.src))].map(name => [
    name,
    readFileSync(resolve(pub, name)).toString('base64')
  ])
)

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const job of jobs) {
    const b64 = await page.evaluate(
      async ({ svg, size, bg }) => {
        const img = new Image()
        img.src = `data:image/svg+xml;base64,${svg}`
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (bg) {
          ctx.fillStyle = bg
          ctx.fillRect(0, 0, size, size)
        }
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, size, size)
        return canvas.toDataURL('image/png').split(',')[1]
      },
      { svg: sources.get(job.src), size: job.size, bg: job.flatten ?? null }
    )
    writeFileSync(resolve(pub, job.out), Buffer.from(b64, 'base64'))
  }
} finally {
  await browser.close()
}

console.log('PWA icons generated:')
for (const job of jobs) {
  console.log(`  public/${job.out}`)
}
