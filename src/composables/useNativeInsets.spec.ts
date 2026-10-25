/* eslint-disable no-console -- 契约说明需要打印 */
/** readNativeInsets 契约:桥与值都来自原生,任何坏输入一律归零,不抛错 */
import { describe, expect, it } from 'vitest'
import { readNativeInsets } from './useNativeInsets'

describe('readNativeInsets · 桥正常', () => {
  it('把原生给的两个数原样交出', () => {
    const r = readNativeInsets({ insetTop: () => 24, insetBottom: () => 48 })
    expect(r).toEqual({ top: 24, bottom: 48 })
    console.log('\n三键导航:top 24 / bottom 48(CSS px)')
  })

  it('手势导航:底部为 0 —— 内容照旧铺到横杠底下,不多垫', () => {
    const r = readNativeInsets({ insetTop: () => 24, insetBottom: () => 0 })
    expect(r.bottom).toBe(0)
  })
})

describe('readNativeInsets · 失效安全', () => {
  it('没有桥(网页 / iOS / 桌面):全 0', () => {
    expect(readNativeInsets(undefined)).toEqual({ top: 0, bottom: 0 })
    expect(readNativeInsets({})).toEqual({ top: 0, bottom: 0 })
  })

  it('桥方法抛错:归 0,不向外抛', () => {
    const r = readNativeInsets({
      insetTop: () => {
        throw new Error('JavaBridge 已销毁')
      },
      insetBottom: () => 48
    })
    expect(r).toEqual({ top: 0, bottom: 48 })
  })

  it('坏值(负数 / NaN / Infinity / 非数字)一律归 0', () => {
    const bad = [-10, Number.NaN, Number.POSITIVE_INFINITY, '48' as unknown as number, null as unknown as number]
    for (const v of bad) {
      const r = readNativeInsets({ insetTop: () => v, insetBottom: () => v })
      expect(r, `坏值 ${String(v)} 应归 0`).toEqual({ top: 0, bottom: 0 })
    }
    console.log('\n负数 / NaN / Infinity / 字符串 / null 全部归 0 —— 坏值撑不爆布局')
  })

  it('故障注入:若不做归零,负数会直接穿出去', () => {
    const raw = { insetBottom: () => -10 }
    expect(raw.insetBottom()).toBe(-10)
    expect(readNativeInsets(raw).bottom).toBe(0)
  })
})
