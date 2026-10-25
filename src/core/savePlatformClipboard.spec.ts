/** 存档导出的 Web 剪贴板兜底:内嵌浏览器 / 部分 WebView(如 taptap)会静默吞掉 a[download](不抛错、无文件) */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

class MemStorage {
  private map = new Map<string, string>()
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v)
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
  clear(): void {
    this.map.clear()
  }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemStorage(), configurable: true })

const mocks = vi.hoisted(() => ({
  saveAs: vi.fn(),
  clipboardWrite: vi.fn()
}))

// 钉死 Web 分支;下载可注入(抛错 = 下载被拦)
vi.mock('@capacitor/core', async () => {
  const actual = await vi.importActual<typeof import('@capacitor/core')>('@capacitor/core')
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => false } }
})
vi.mock('file-saver', () => ({ saveAs: mocks.saveAs }))

/** 剪贴板开关:可用时给可追踪的 writeText,否则彻底没有 */
function stubClipboard(available: boolean): void {
  const nav = (globalThis as Record<string, unknown>).navigator as { clipboard?: unknown } | undefined
  const target = nav ?? {}
  Object.defineProperty(target, 'clipboard', {
    value: available ? { writeText: mocks.clipboardWrite } : undefined,
    configurable: true
  })
  if (!nav) Object.defineProperty(globalThis, 'navigator', { value: target, configurable: true })
}

describe('savePlatform · Web 剪贴板兜底', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.saveAs.mockReset()
    mocks.clipboardWrite.mockReset()
    mocks.clipboardWrite.mockResolvedValue(undefined)
    stubClipboard(true)
  })

  it('下载成功 + 剪贴板可用:返回 null(存档已落盘,时间戳照常记账)', async () => {
    mocks.saveAs.mockReturnValue(undefined)
    const { exportSaveToDevice } = await import('./savePlatform')
    await expect(exportSaveToDevice()).resolves.toBeNull()
    expect(mocks.clipboardWrite).toHaveBeenCalled()
  })

  it('下载被拦截 + 剪贴板可用:不给「已导出」的假象,文本已进剪贴板', async () => {
    mocks.saveAs.mockImplementation(() => {
      throw new Error('download blocked')
    })
    const { exportSaveToDevice } = await import('./savePlatform')
    const msg = await exportSaveToDevice()
    expect(msg, '只进剪贴板不该返回 null(不是持久备份,不该更新上次导出时间戳)').not.toBeNull()
    expect(mocks.clipboardWrite, '剪贴板要真的写进存档文本').toHaveBeenCalled()
  })

  it('下载与剪贴板都不可用:明说失败,不沉默', async () => {
    mocks.saveAs.mockImplementation(() => {
      throw new Error('download blocked')
    })
    stubClipboard(false)
    const { exportSaveToDevice } = await import('./savePlatform')
    const msg = await exportSaveToDevice()
    expect(msg).not.toBeNull()
    expect(mocks.clipboardWrite).not.toHaveBeenCalled()
  })

  it('内嵌浏览器静默吞下载(不抛错、也没文件):剪贴板仍是保底,提示讲明退路', async () => {
    // 模拟 taptap WebView:saveAs 看似成功,实际没有文件
    mocks.saveAs.mockReturnValue(undefined)
    const { exportSaveToDevice } = await import('./savePlatform')
    const msg = await exportSaveToDevice()
    // 静默吞掉无法探测,仍返回 null;保底靠 toast 里的「已复制到剪贴板」
    expect(msg).toBeNull()
    expect(mocks.clipboardWrite, '即便下载看似成功,剪贴板照写 —— 这是唯一的保底').toHaveBeenCalled()
  })
})
