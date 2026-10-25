/**
 * 存档导出平台分叉:Web/Electron 走 saveAs,Android 走 SaveTransfer 的 SAF 保存面板,
 * 其他 Capacitor 原生走 Filesystem.writeFile。
 * 故障注入:把 Android 分支改回 requestPermissions + writeFile,或把 saved=false 当成功,对应用例红。
 */
import { createPinia, setActivePinia } from 'pinia'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** node 环境无 localStorage,buildExportPayload 要读它 */
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
  writeFile: vi.fn().mockResolvedValue({ uri: 'out.save' }),
  requestPermissions: vi.fn().mockResolvedValue({ publicStorage: 'granted' }),
  isNativePlatform: vi.fn(() => false),
  getPlatform: vi.fn(() => 'web'),
  saveTransfer: vi.fn().mockResolvedValue({ saved: true }),
  registerPlugin: vi.fn()
}))

// 可追踪桩:断言 Web 端不调用
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: mocks.writeFile, requestPermissions: mocks.requestPermissions },
  Directory: { Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' }
}))

vi.mock('@capacitor/core', async () => {
  const actual = await vi.importActual<typeof import('@capacitor/core')>('@capacitor/core')
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      isNativePlatform: mocks.isNativePlatform,
      getPlatform: mocks.getPlatform,
      registerPlugin: mocks.registerPlugin
    }
  }
})

import { Capacitor } from '@capacitor/core'

describe('savePlatform(Web 分支)', () => {
  beforeEach(() => {
    // 成功路径也 toast,需 Pinia
    setActivePinia(createPinia())
    mocks.writeFile.mockClear()
    mocks.requestPermissions.mockReset()
    mocks.requestPermissions.mockResolvedValue({ publicStorage: 'granted' })
    mocks.isNativePlatform.mockReset()
    mocks.isNativePlatform.mockReturnValue(false)
    mocks.getPlatform.mockReset()
    mocks.getPlatform.mockReturnValue('web')
    mocks.saveTransfer.mockReset()
    mocks.saveTransfer.mockResolvedValue({ saved: true })
    mocks.registerPlugin.mockReset()
    mocks.registerPlugin.mockReturnValue({ save: mocks.saveTransfer })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Web 端(非原生):导出成功返回 null,且绝不触碰 Filesystem', async () => {
    expect(Capacitor.isNativePlatform()).toBe(false)

    const { exportSaveToDevice } = await import('./savePlatform')
    const result = await exportSaveToDevice()

    expect(result).toBeNull()
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(mocks.saveTransfer).not.toHaveBeenCalled()
  })

  it('Android 走 SAF:不请求存储权限、不写 Documents,保存成功后返回 null', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    mocks.getPlatform.mockReturnValue('android')

    const { exportSaveToDevice } = await import('./savePlatform')
    const { useUiStore } = await import('@/stores/ui')
    const result = await exportSaveToDevice()

    expect(result, '系统保存面板写完文件后才算成功').toBeNull()
    expect(mocks.registerPlugin, '要取用 Android 原生 SAF 桥').toHaveBeenCalledWith('SaveTransfer')
    expect(mocks.saveTransfer, '存档文本与 .save 文件名都要交给原生桥').toHaveBeenCalledWith({
      text: expect.any(String),
      fileName: expect.stringMatching(/^yunyin-xiuxian-\d{4}-\d{2}-\d{2}\.save$/)
    })
    expect(mocks.requestPermissions, 'SAF 不需要公共存储权限').not.toHaveBeenCalled()
    expect(mocks.writeFile, 'Android 不得再直接写公共 Documents').not.toHaveBeenCalled()
    expect(useUiStore().toasts).toContainEqual(
      expect.objectContaining({ text: expect.stringContaining('已导出「yunyin-xiuxian-'), kind: 'success' })
    )
  })

  it('Android 用户在保存面板取消:不假装成功,设置页不记上次导出', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    mocks.getPlatform.mockReturnValue('android')
    mocks.saveTransfer.mockResolvedValue({ saved: false })

    const { exportSaveToDevice } = await import('./savePlatform')
    const { useUiStore } = await import('@/stores/ui')
    const result = await exportSaveToDevice()

    expect(result, '取消不是持久备份,必须返回非 null').toBe('已取消导出')
    expect(useUiStore().toasts).toContainEqual(expect.objectContaining({ text: '已取消导出', kind: 'warn' }))
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('Android 原生桥回包缺少 saved 字段:报协议失败,不冒充已导出或用户取消', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    mocks.getPlatform.mockReturnValue('android')
    mocks.saveTransfer.mockResolvedValue({})

    const { exportSaveToDevice } = await import('./savePlatform')
    const { useUiStore } = await import('@/stores/ui')
    const result = await exportSaveToDevice()

    expect(result, '未知回包不是持久备份,也不能甩锅给玩家').toContain('无法识别的结果')
    expect(useUiStore().toasts, '玩家只看到失败状态,不念协议细节').toContainEqual(
      expect.objectContaining({ text: '导出失败', kind: 'warn' })
    )
  })

  it('Android 原生写入失败:toast 只报导出失败,真实原因留在返回值', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    mocks.getPlatform.mockReturnValue('android')
    mocks.saveTransfer.mockRejectedValue(new Error('目标文件不可写'))

    const { exportSaveToDevice } = await import('./savePlatform')
    const { useUiStore } = await import('@/stores/ui')
    const result = await exportSaveToDevice()

    expect(result).toContain('存档导出失败')
    expect(result).toContain('目标文件不可写')
    expect(useUiStore().toasts).toContainEqual(expect.objectContaining({ text: '导出失败', kind: 'warn' }))
    expect(useUiStore().toasts.map(t => t.text).join(), '原生报错原文不进 toast').not.toContain('目标文件不可写')
  })

  it('其他原生端存储权限被拒:不写盘,并给玩家明确警告回执', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    mocks.getPlatform.mockReturnValue('ios')
    mocks.requestPermissions.mockResolvedValue({ publicStorage: 'denied' })

    const { exportSaveToDevice } = await import('./savePlatform')
    const { useUiStore } = await import('@/stores/ui')
    const result = await exportSaveToDevice()

    expect(result, '失败原因仍要返回,设置页据此不记「上次导出」').toBe('存储权限被拒绝')
    expect(mocks.writeFile, '权限被拒时不该继续尝试写 Documents').not.toHaveBeenCalled()
    expect(useUiStore().toasts, '玩家点了导出后必须看到为什么没成').toContainEqual(
      expect.objectContaining({ text: '存储权限被拒绝', kind: 'warn' })
    )
    expect(mocks.saveTransfer, '非 Android 不该调用 Android SAF 桥').not.toHaveBeenCalled()
  })

  it('其他原生端首次导出递归创建 Export 父目录', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    mocks.getPlatform.mockReturnValue('ios')

    const { exportSaveToDevice } = await import('./savePlatform')
    const result = await exportSaveToDevice()

    expect(result).toBeNull()
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringMatching(/^Export\/yunyin-xiuxian-\d{4}-\d{2}-\d{2}\.save$/),
        directory: 'DOCUMENTS',
        encoding: 'utf8',
        recursive: true
      })
    )
  })
})
