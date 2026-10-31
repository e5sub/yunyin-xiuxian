import { describe, expect, it } from 'vitest'
import { basketEmpty, castHint, fortuneTone, riddleVerdict } from './leisureText'

const R = (v: Partial<Record<'stone' | 'herb' | 'wudao' | 'ore' | 'dust' | 'page', number>> = {}) => ({
  stone: 0,
  herb: 0,
  wudao: 0,
  ore: 0,
  dust: 0,
  page: 0,
  ...v
})

describe('闲趣三则 · 展示口径', () => {
  it('签等按四档着色,越吉越暖', () => {
    expect(fortuneTone(3)).toBe('text-cinnabar')
    expect(fortuneTone(2)).toBe('text-gold-ink')
    expect(fortuneTone(1)).toBe('text-azure')
    expect(fortuneTone(0)).toBe('text-ink-faint')
    // 越界不外溢:高不降到吉,低不升到吉
    expect(fortuneTone(9)).toBe('text-cinnabar')
    expect(fortuneTone(-1)).toBe('text-ink-faint')
  })

  it('篓空判据看六项合计', () => {
    expect(basketEmpty(R())).toBe(true)
    expect(basketEmpty(R({ herb: 1 }))).toBe(false)
    expect(basketEmpty(R({ page: 1 }))).toBe(false)
    expect(basketEmpty(R({ stone: 0 }))).toBe(true)
  })

  it('起竿提示随剩余竿数变化,用尽后不再催', () => {
    expect(castHint(0, 3)).toBe('还可起3竿')
    expect(castHint(1, 3)).toBe('还可起两竿')
    expect(castHint(2, 3)).toBe('只余一竿')
    expect(castHint(3, 3)).toBe('今日竿已收')
    // 服务端若改上限,提示跟着走
    expect(castHint(0, 5)).toBe('还可起5竿')
    expect(castHint(9, 3)).toBe('今日竿已收')
  })

  it('谜面判词三态', () => {
    expect(riddleVerdict(false, null)).toBe('尚未作答')
    expect(riddleVerdict(true, true)).toBe('答对了')
    expect(riddleVerdict(true, false)).toBe('答错了')
    // 已答但服务端未回结果时按错处理,不谎报答对
    expect(riddleVerdict(true, null)).toBe('答错了')
  })
})
