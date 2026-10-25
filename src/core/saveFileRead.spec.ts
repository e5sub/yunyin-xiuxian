/**
 * 存档文件读取:abort 后 load / error 回调都不再执行。
 * 迟到回调会 engine.pause() 并写已销毁组件的 ref,resume 不到则游戏永久暂停。
 * 故障注入:把 abort 改回只调 reader.abort() 而不置 settled,「卸载时 abort」用例红。
 */
import { describe, expect, it } from 'vitest'
import { readSaveFile } from './saveFileRead'

class FakeFileReader {
  result: string | ArrayBuffer | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  aborted = false

  readAsText(): void {}

  abort(): void {
    this.aborted = true
  }

  finish(text: string): void {
    this.result = text
    this.onload?.()
  }

  fail(): void {
    this.onerror?.()
  }
}

describe('存档文件读取 · 取消即失效', () => {
  it('读取完成回调拿到文件文本', () => {
    const reader = new FakeFileReader()
    const loaded: string[] = []
    readSaveFile({ name: 'save.json' } as File, text => loaded.push(text), () => undefined, () => reader as unknown as FileReader)
    reader.finish('{"game":"yunyin-xiuxian"}')
    expect(loaded).toEqual(['{"game":"yunyin-xiuxian"}'])
  })

  it('卸载时 abort:迟到的 load 与 error 都不再回调', () => {
    const reader = new FakeFileReader()
    let loads = 0
    let errors = 0
    const handle = readSaveFile(
      { name: 'save.json' } as File,
      () => {
        loads += 1
      },
      () => {
        errors += 1
      },
      () => reader as unknown as FileReader
    )
    handle.abort()
    expect(reader.aborted, '取消应真的中止底层读取').toBe(true)
    reader.finish('迟到内容')
    reader.fail()
    expect(loads, '取消后不该再暂停引擎/写已销毁组件').toBe(0)
    expect(errors, '取消后不该再弹读取失败回执').toBe(0)
  })

  it('先完成再 abort 是幂等的:不会重复回调,也不抛', () => {
    const reader = new FakeFileReader()
    let loads = 0
    const handle = readSaveFile(
      { name: 'save.json' } as File,
      () => {
        loads += 1
      },
      () => undefined,
      () => reader as unknown as FileReader
    )
    reader.finish('ok')
    expect(() => handle.abort()).not.toThrow()
    reader.finish('again')
    expect(loads).toBe(1)
  })
})
