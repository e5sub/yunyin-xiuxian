/**
 * 服务端权威推进 —— 无头结算链的判据(src/core/advanceResolve 经 server/vendor 动态加载)。
 *
 * 心跳与离线都走这一条链:水合 17 分片 → 收口上报的修为/灵气/会话 → 跑共享推进
 * (与客户端显示预测同一份代码)→ 顶层键级 diff。判据三件事:
 *   · 生产只认服务端推演,客户端上报的天文修为进不了档;
 *   · 离线按服务端时间锚点起算,归来卷轴随结果回传;
 *   · 会话声明只承载节拍与展示,形状非法整条忽略,不炸推进。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

let mockRand = 0
vi.mock('@/utils/random', async importOriginal => {
  const mod = await importOriginal<typeof import('@/utils/random')>()
  return { ...mod, rng: new mod.RandomService(() => mockRand) }
})

import { resolveAdvanceFromSlices } from './advanceResolve'
import { toNum } from '@/utils/gnum'
import { OFFLINE_MIN_SECONDS, QI_BANK_MULT } from '@/data/constants'
import { REGIONS } from '@/data/regions'
import { usePlayerStore } from '@/stores/player'

/** 一份「炼气一层,开局 10 秒」的最小档:缺的分片按 store 默认值水合 */
function save(): Record<string, unknown> {
  return {
    game: { started: true, lastActiveAt: Date.now() - 10_000 },
    player: { major: 0, sub: 0, exp: { m: 1, e: 2 }, age: 16, dead: false },
    resources: { qi: 100, spiritStone: { m: 1, e: 3 } },
    dongfu: { offlineCapHours: 8 },
    cultivation: { buffs: [] },
    adventure: { session: null }
  }
}

describe('推进无头结算 · 形状门槛', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockRand = 0
  })

  it('未开局 / 缺境界 / dt 非正:拒绝推进(返回 null)', async () => {
    const notStarted = save()
    notStarted.game = { started: false }
    await expect(resolveAdvanceFromSlices(notStarted, {}, { dtSec: 10, offline: false })).resolves.toBeNull()

    const noRealm = save()
    delete (noRealm.player as Record<string, unknown>).major
    await expect(resolveAdvanceFromSlices(noRealm, {}, { dtSec: 10, offline: false })).resolves.toBeNull()

    await expect(resolveAdvanceFromSlices(save(), {}, { dtSec: 0, offline: false })).resolves.toBeNull()
  })
})

describe('推进无头结算 · 在线生产', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockRand = 0
  })

  it('10 秒窗口:修为按产速推进,增量 > 0', async () => {
    const resolved = await resolveAdvanceFromSlices(save(), {}, { dtSec: 10, offline: false })
    expect(resolved).not.toBeNull()
    const exp = resolved!.patches.player?.exp as { m: number; e: number } | undefined
    expect(exp, '生产会涨修为').toBeDefined()
    expect(toNum(exp!)).toBeGreaterThan(100)
    expect(resolved!.summary).toBeNull()
    expect(resolved!.snapshot).not.toBeNull()
  })

  it('上报天文修为:超出「存量 + 产出预算」的部分不采信', async () => {
    const resolved = await resolveAdvanceFromSlices(save(), { exp: { m: 1, e: 9 } }, { dtSec: 10, offline: false })
    const exp = resolved!.patches.player?.exp as { m: number; e: number } | undefined
    expect(toNum(exp!)).toBeLessThan(1e9)
  })

  it('上报天文灵气:按积余容量收口', async () => {
    // resolve 内部会换/清 active pinia:cap 要在调用前取好
    const cap = usePlayerStore().qiCapValue
    const resolved = await resolveAdvanceFromSlices(save(), { qi: 1e15 }, { dtSec: 10, offline: false })
    const qi = resolved!.patches.resources?.qi as number | undefined
    /*
     * 采信值恰被钳到积余容量、推进又顶在同一道闸(setQi 顶 = 标称 × QI_BANK_MULT)上:
     * 快照前后同值,补丁可能为空 —— 无论如何都不能超出货余容量。
     */
    if (qi !== undefined) expect(qi, '天文灵气必须被压回积余容量之内').toBeLessThanOrEqual(cap * QI_BANK_MULT)
  })

  it('容量以上的合法积余照采:灵气声明按积余容量收口,不再被砍回标称容量', async () => {
    /*
     * 1.79.19 前的收口钳在 qiCapValue(标称容量)上:玩家经 setQi(顶 = 标称 × QI_BANK_MULT)
     * 攒出来的合法积余,每拍心跳都被砍回标称容量,「积余蓄满」永远走不完 —— 修为/灵气
     * 存不满的灵气半边。判据:报 5 倍标称容量(远超标称、仍在积余容量内)要被采信,
     * 补丁落在 5 倍附近;天文数字才被压回积余容量。
     */
    const cap = usePlayerStore().qiCapValue
    const resolved = await resolveAdvanceFromSlices(save(), { qi: cap * 5 }, { dtSec: 10, offline: false })
    const qi = resolved!.patches.resources?.qi as number | undefined
    expect(qi, '5 倍容量的合法积余必须被采信(旧版会被砍回 1 倍容量)').toBeGreaterThan(cap * 1.5)
    expect(qi!).toBeLessThanOrEqual(cap * QI_BANK_MULT)
  })

  it('门派状态随 sect 入参进推进:注入后产速比无门派高', async () => {
    /*
     * 门派不进存档分片(整份状态只住服务端表)。1.79.19 前推进水合漏了它:
     * 服务端复算的 cultPerSec 缺门派技能/建筑/武学的加成,心跳补丁每拍把客户端
     * 涨好的修为拽回去 —— 修为存不满的另一半。判据:同一份档,带门派(引气归元 5 重
     * = 修炼 +10%、回气 +20%)的推进,修为补丁必须比无门派的大。
     */
    const baseline = await resolveAdvanceFromSlices(save(), {}, { dtSec: 10, offline: false })
    const withSect = await resolveAdvanceFromSlices(save(), {}, { dtSec: 10, offline: false }, {
      name: '丹霞门',
      role: 'leader',
      personal: 0,
      pool: 0,
      skills: { danxia_qi: 5 },
      arts: {},
      buildings: { hall: 1 }
    })
    const plain = toNum(baseline!.patches.player?.exp as { m: number; e: number })
    const sected = toNum(withSect!.patches.player?.exp as { m: number; e: number })
    expect(sected, '门派修炼加成必须进服务端推进(旧版漏注,产速比面板低)').toBeGreaterThan(plain)
    /*
     * 差值判据,不用比值:推进里还有与产速无关的固定进项(洞府产出/藏经阁钻研),
     * 它们会把「+10% 产速」的比值稀释到 1.0x,绝对差才是门派加成的那一份
     * (本夹具 10 秒窗 = base × 10% × 10 ≈ 1.5)。qiRegen 同源:带门派的灵气补丁也要更大。
     */
    expect(sected - plain, '引气归元 5 重 + 山门 1 级的修炼加成要落在绝对差上').toBeGreaterThan(1)
    const plainQi = baseline!.patches.resources?.qi as number | undefined
    const sectQi = withSect!.patches.resources?.qi as number | undefined
    expect(sectQi, '门派回气加成也要进灵气补丁').toBeGreaterThan(plainQi!)
  })
})

describe('推进无头结算 · 离线结算', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockRand = 0
  })

  it('超过 OFFLINE_MIN_SECONDS 的窗口按离线结:卷轴回传,修为按效率折算', async () => {
    const resolved = await resolveAdvanceFromSlices(save(), {}, { dtSec: 3600, offline: true })
    expect(resolved).not.toBeNull()
    const summary = resolved!.summary
    expect(summary, '离线结算必带归来卷轴').not.toBeNull()
    expect(summary!.seconds).toBe(3600)
    const exp = resolved!.patches.player?.exp as { m: number; e: number } | undefined
    expect(exp).toBeDefined()
    expect(toNum(exp!)).toBeGreaterThan(100)
    // 离线效率(OFFLINE_EFFICIENCY < 1)打折:整窗产值不得超过产速 × 全窗
    expect(toNum(exp!)).toBeLessThan(1e12)
    // 结算尾部盖戳:游戏分片的 lastActiveAt 被推进到当下附近
    const game = resolved!.patches.game as Record<string, unknown> | undefined
    expect(game?.lastActiveAt).toBeGreaterThan(Date.now() - 60_000)
  })

  it('云档里的天文灵石(格式合法的 e225)首拍即被治好:补丁压回收口上界(1.79.20)', async () => {
    /*
     * 1.78.0 起进度不再上传,整档归一化(sanitizeSaveSlices 的 tightenVitals)对存量玩家
     * 永不执行;水合此前只 $patch 不修形,坏值一边驱动结算一边随补丁固化。
     * 判据:基线截在修形之前,修形修正值随键级 diff 进补丁 —— 第一拍就把云档压回
     * SPIRIT_STONE_EXP_MAX 之内,且当拍离线收益结在收口后的基线上(不是坏值之上)。
     */
    const bad = save()
    ;(bad.resources as Record<string, unknown>).spiritStone = { m: 2.9, e: 225 }
    const resolved = await resolveAdvanceFromSlices(bad, {}, { dtSec: 3600, offline: true })
    expect(resolved).not.toBeNull()
    const stone = resolved!.patches.resources?.spiritStone as { m: number; e: number } | undefined
    expect(stone, '天文灵石必须出现在补丁里(否则云档永远治不好)').toBeDefined()
    expect(stone!.e, '补丁值须压回收口上界(e150)之内').toBeLessThanOrEqual(150)
  })
})

describe('推进无头结算 · 会话声明', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockRand = 0
  })

  it('形状非法(区域不存在):整条忽略,推进照常', async () => {
    const resolved = await resolveAdvanceFromSlices(
      save(),
      { session: { regionId: 'no_such_region', mode: 'normal', startedAt: Date.now(), endsAt: Date.now() + 6e5, nextBattleAt: Date.now() + 6e5 } },
      { dtSec: 10, offline: false }
    )
    expect(resolved).not.toBeNull()
    expect(resolved!.patches.adventure, '非法会话不得写进档').toBeUndefined()
  })

  it('形状合法(下一战已到期):会话被采信,本窗真的开打', async () => {
    // rand 0.99 让际遇判定(rng.chance)落空,到点必走战斗分支
    mockRand = 0.99
    const now = Date.now()
    const regionId = REGIONS[0]!.id
    const session = {
      regionId,
      mode: 'normal',
      startedAt: now,
      endsAt: now + 1_800_000,
      nextBattleAt: now - 1_000,
      wins: 0,
      losses: 0,
      events: 0,
      stoneGain: { m: 0, e: 0 },
      expGain: { m: 0, e: 0 },
      itemGain: 0
    }
    const resolved = await resolveAdvanceFromSlices(save(), { session }, { dtSec: 10, offline: false })
    expect(resolved).not.toBeNull()
    const adv = resolved!.patches.adventure as Record<string, unknown> | undefined
    expect(adv, '会话被采信并推进:战斗动了档').toBeDefined()
    expect(adv, '战报入档(recordBattle 随分片持久化)').toHaveProperty('lastBattle')
  })

  it('长程模式(涉险/长线/彻夜/远涉):endsAt 在数小时外也照采信、照开打(1.79.3)', async () => {
    mockRand = 0.99
    const now = Date.now()
    const regionId = REGIONS[0]!.id
    // 四种模式的时长,endsAt 全部越过旧的 ±1h 窗;下一战已到期
    for (const [mode, durMs] of [
      ['risky', 7_200_000],
      ['prolonged', 14_400_000],
      ['marathon', 28_800_000],
      ['deepExpedition', 57_600_000]
    ] as const) {
      const session = {
        regionId,
        mode,
        startedAt: now,
        endsAt: now + durMs,
        nextBattleAt: now - 1_000,
        wins: 0,
        losses: 0,
        events: 0,
        stoneGain: { m: 0, e: 0 },
        expGain: { m: 0, e: 0 },
        itemGain: 0
      }
      const resolved = await resolveAdvanceFromSlices(save(), { session }, { dtSec: 10, offline: false })
      expect(resolved, `${mode} 不该被判越界`).not.toBeNull()
      const adv = resolved!.patches.adventure as Record<string, unknown> | undefined
      expect(adv, `${mode} 会话应被采信并开打`).toHaveProperty('lastBattle')
    }
  })

  it('形状合法但时间越界(endsAt 在一周之外):整条忽略', async () => {
    const now = Date.now()
    const resolved = await resolveAdvanceFromSlices(
      save(),
      { session: { regionId: REGIONS[0]!.id, mode: 'normal', startedAt: now, endsAt: now + 9 * 86_400_000, nextBattleAt: now } },
      { dtSec: 10, offline: false }
    )
    expect(resolved).not.toBeNull()
    expect(resolved!.patches.adventure).toBeUndefined()
  })
})

/** 防呆:离线门槛常量与 data/constants 同值(路由侧的镜像另在 server/routes/game.ts 注释里钉) */
describe('推进无头结算 · 常量对齐', () => {
  it('离线门槛就是 OFFLINE_MIN_SECONDS', () => {
    expect(OFFLINE_MIN_SECONDS).toBe(120)
  })
})
