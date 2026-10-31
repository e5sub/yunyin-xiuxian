/**
 * 闲趣三则:观星台、灵泉垂钓、山门猜谜。
 *
 * 与「周天七会」并行的第二条线 —— 七会要动手,闲趣只要来坐坐。
 * 规矩照旧:换日按北京时间零点、结果由服务端裁定、每日各有额度(一签 / 三竿 / 一问)。
 *
 * 三则都不碰既有玩法:不消耗行动次数,不改战斗数值,只发一份小赏。
 * 观星与猜谜的题面按「日号哈希」定,同一天全服同一签、同一题,便于道友在群里对签;
 * 垂钓每次现掷,钓到的先入篓,由玩家自己收篓入账 —— 半路关掉界面也不会白钓。
 */
import { get, run } from './db.js'
import { getConfig } from './config.js'
import { dayKeyOf, secsToNextDay } from './eventCore.js'

/** 赏格形状与七会一致:灵石给基础值,客户端按自身层级折算 */
export interface LeisureReward {
  stone: number
  herb: number
  wudao: number
  ore: number
  dust: number
  page: number
}

const ZERO = (): LeisureReward => ({ stone: 0, herb: 0, wudao: 0, ore: 0, dust: 0, page: 0 })

function merge(a: LeisureReward, b: Partial<LeisureReward>): LeisureReward {
  return {
    stone: a.stone + (b.stone ?? 0),
    herb: a.herb + (b.herb ?? 0),
    wudao: a.wudao + (b.wudao ?? 0),
    ore: a.ore + (b.ore ?? 0),
    dust: a.dust + (b.dust ?? 0),
    page: a.page + (b.page ?? 0)
  }
}

/* ---------------- 观星 ---------------- */

/** rank:3 大吉 / 2 吉 / 1 小吉 / 0 平 —— 只影响文案颜色与赏格轻重 */
export interface Fortune {
  rank: number
  grade: string
  poem: string
  read: string
  reward: LeisureReward
}

const F = (rank: number, grade: string, poem: string, read: string, reward: Partial<LeisureReward>): Fortune => ({
  rank,
  grade,
  poem,
  read,
  reward: { ...ZERO(), ...reward }
})

/** 十二签:一签大吉、三签吉、五签小吉、三签平,免得人人天天大吉 */
export const FORTUNES: Fortune[] = [
  F(3, '大吉', '云开见斗柄,万里一天青', '所行无碍。宜远行,宜访友,宜开新篇。', { stone: 160, wudao: 10 }),
  F(2, '吉', '松风清入座,月色满空庭', '心境澄明,坐忘亦有所得。', { stone: 100, wudao: 6 }),
  F(2, '吉', '石上泉声细,林间鹤影迟', '缓中有得,不必争先。', { stone: 100, wudao: 6 }),
  F(2, '吉', '一灯续晓色,万壑待春雷', '守之待时,春来自发。', { stone: 100, wudao: 6 }),
  F(1, '小吉', '竹密不妨流水过,山高岂碍白云飞', '小阻无碍,绕过便是。', { stone: 60, wudao: 3 }),
  F(1, '小吉', '炉中丹未熟,且坐看云起', '时候未到,稍安勿躁。', { stone: 60, wudao: 3 }),
  F(1, '小吉', '半窗残月,一枕新凉', '清静自守,无咎。', { stone: 60, wudao: 3 }),
  F(1, '小吉', '路转溪桥忽见', '转机在侧,勿弃前功。', { stone: 60, wudao: 3 }),
  F(1, '小吉', '细雨湿衣看不见', '润物无声,积微成著。', { stone: 60, wudao: 3 }),
  F(0, '平', '风过疏竹,风去而竹不留声', '来去皆空,守常而已。', { stone: 24 }),
  F(0, '平', '雁过长空,影沉寒水', '雁无遗踪之意,水无留影之心。', { stone: 24 }),
  F(0, '平', '闲敲棋子落灯花', '有约不来,且自消遣。', { stone: 24 })
]

/* ---------------- 垂钓 ---------------- */

export interface Catch {
  id: string
  /** 起竿时的一句话 */
  label: string
  weight: number
  reward: Partial<LeisureReward>
}

/** 权重合计 100;空竿留一成半,免得三竿必满 */
export const CATCHES: Catch[] = [
  { id: 'weed', label: '只钓上一把水草', weight: 16, reward: {} },
  { id: 'herb1', label: '一株灵草,叶上还挂着露', weight: 30, reward: { herb: 1 } },
  { id: 'herb2', label: '两株灵草,并蒂而生', weight: 12, reward: { herb: 2 } },
  { id: 'ore1', label: '一块玄铁,沉手', weight: 14, reward: { ore: 1 } },
  { id: 'dust1', label: '一撮器灵尘,随水旋起', weight: 12, reward: { dust: 1 } },
  { id: 'stone1', label: '一只旧囊,囊中是灵石', weight: 13, reward: { stone: 30 } },
  { id: 'page1', label: '半页残篇,墨迹未散', weight: 3, reward: { page: 1 } }
]

/** 每日可起竿次数 */
export const MAX_CASTS = 3

/* ---------------- 猜谜 ---------------- */

export interface Riddle {
  q: string
  options: string[]
  /** 正确项下标 */
  answer: number
  /** 答后揭晓的一句 */
  note: string
}

/** 十二问:老谜面为主,不取偏僻,答不上也能会心一笑 */
export const RIDDLES: Riddle[] = [
  {
    q: '有风不动无风动,不动无风动有风。',
    options: ['扇子', '灯笼', '风铃', '纸鸢'],
    answer: 0,
    note: '扇子不动则无风,一摇风自来。'
  },
  {
    q: '千条线,万条线,落在水里看不见。',
    options: ['渔网', '雨', '柳丝', '日光'],
    answer: 1,
    note: '雨落水面,只余涟漪。'
  },
  {
    q: '远看山有色,近听水无声;春去花还在,人来鸟不惊。',
    options: ['梦境', '画卷', '镜中景', '雪后山'],
    answer: 1,
    note: '有声有色而皆不动,是画。'
  },
  {
    q: '三个口,叠成山;尝滋味,它最先。',
    options: ['晶', '品', '磊', '森'],
    answer: 1,
    note: '三口为品,品者尝味。'
  },
  {
    q: '一口咬掉牛尾巴。',
    options: ['告', '生', '先', '牟'],
    answer: 0,
    note: '「牛」去其尾,加一口,成「告」。'
  },
  {
    q: '八十八。',
    options: ['米', '木', '林', '烊'],
    answer: 0,
    note: '「八」+「十」+「八」,合而为「米」。'
  },
  {
    q: '上不在上,下不在下;不可在上,且宜在下。',
    options: ['一', '十', '卜', '丁'],
    answer: 0,
    note: '「上」「下」「不」「且」诸字之中,它皆居下。'
  },
  {
    q: '有骨没有肉,有脚没有手;下雨才出门,晴天家中坐。',
    options: ['斗笠', '蓑衣', '伞', '木屐'],
    answer: 2,
    note: '骨为伞骨,脚为伞柄之撑。'
  },
  {
    q: '有面没有口,有脚没有手;虽有四只脚,自己不会走。',
    options: ['床', '桌子', '屏风', '书案'],
    answer: 1,
    note: '四脚而立,面平无口,是桌。'
  },
  {
    q: '你对它笑,它也笑;你对它哭,它也哭。',
    options: ['影子', '镜子', '回声', '水面'],
    answer: 1,
    note: '镜中形容,随人而动。'
  },
  {
    q: '生在山上,死在锅里,埋在罐里,活在杯里。',
    options: ['草药', '茶叶', '桂花', '松子'],
    answer: 1,
    note: '一叶茶,历四死四生。'
  },
  {
    q: '小时穿黑衣,长大穿白袍;到老留下一卷丝,自己却不见了。',
    options: ['蚕', '蝶', '蛛', '蝉'],
    answer: 0,
    note: '蚕虽作茧,丝成而身隐。'
  }
]

/* ---------------- 日号与确定性 ---------------- */

/** FNV-1a:同一「用户+日号+项」每天固定落一签,换日自换 */
function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** 今日签号 */
export function fortuneIndexOf(userId: number, day: string): number {
  return hash32(`${userId}:${day}:star`) % FORTUNES.length
}

/** 今日问号:全服同题,便于道友互相考较 */
export function riddleIndexOf(day: string): number {
  return hash32(`${day}:riddle`) % RIDDLES.length
}

/* ---------------- 存储 ---------------- */

export type LeisureKind = 'star' | 'fish' | 'riddle'

interface Row {
  tries: number
  value: number
  payload: string
  claimed: number
}

const EMPTY_ROW: Row = { tries: 0, value: 0, payload: '', claimed: 0 }

async function readRow(userId: number, day: string, kind: LeisureKind): Promise<Row> {
  const r = await get<Row>('SELECT tries, value, payload, claimed FROM leisure_log WHERE user_id = ? AND day = ? AND kind = ?', [
    userId,
    day,
    kind
  ])
  if (r === undefined) return { ...EMPTY_ROW }
  return {
    tries: Math.max(0, Math.trunc(r.tries)),
    value: Math.trunc(r.value),
    payload: typeof r.payload === 'string' ? r.payload : '',
    claimed: r.claimed === 1 ? 1 : 0
  }
}

async function writeRow(
  userId: number,
  day: string,
  kind: LeisureKind,
  v: { tries: number; value: number; payload: string; claimed: boolean }
): Promise<void> {
  await run(
    'REPLACE INTO leisure_log (user_id, day, kind, tries, value, payload, claimed, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [userId, day, kind, Math.max(0, Math.trunc(v.tries)), Math.trunc(v.value), v.payload, v.claimed ? 1 : 0, Date.now()]
  )
}

/** 垂钓篓:累计收获 + 每竿的钓获名(展示用) */
interface Basket {
  reward: LeisureReward
  caught: string[]
}

function parseBasket(payload: string): Basket {
  try {
    const o = JSON.parse(payload) as Partial<Basket>
    const r: Partial<LeisureReward> = o?.reward ?? {}
    const reward: LeisureReward = {
      stone: Math.max(0, Math.trunc(Number(r.stone ?? 0))),
      herb: Math.max(0, Math.trunc(Number(r.herb ?? 0))),
      wudao: Math.max(0, Math.trunc(Number(r.wudao ?? 0))),
      ore: Math.max(0, Math.trunc(Number(r.ore ?? 0))),
      dust: Math.max(0, Math.trunc(Number(r.dust ?? 0))),
      page: Math.max(0, Math.trunc(Number(r.page ?? 0)))
    }
    const caught = Array.isArray(o?.caught) ? o.caught.filter((x): x is string => typeof x === 'string').slice(0, MAX_CASTS) : []
    return { reward, caught }
  } catch {
    return { reward: ZERO(), caught: [] }
  }
}

/* ---------------- 对外视图 ---------------- */

export interface FortuneView extends Fortune {
  index: number
}

export interface LeisureToday {
  enabled: boolean
  day: string
  now: number
  secsToNext: number
  star: { drawn: boolean; fortune: FortuneView | null }
  fish: { casts: number; max: number; basket: LeisureReward; caught: string[]; claimed: boolean }
  riddle: { q: string; options: string[]; answered: boolean; correct: boolean | null; note: string | null }
}

/** 观星:今日签(未抽也先给签文,点了才算领) */
function fortuneView(userId: number, day: string): FortuneView {
  const index = fortuneIndexOf(userId, day)
  return { index, ...FORTUNES[index]! }
}

/** 猜谜:题面与选项照发,答案不下发 */
export function riddleOfDay(day: string): { q: string; options: string[] } {
  const r = RIDDLES[riddleIndexOf(day)]!
  return { q: r.q, options: [...r.options] }
}

export async function leisureEnabled(): Promise<boolean> {
  return (await getConfig('leisure_enabled', 'true')) !== 'false'
}

export async function leisureToday(userId: number, now = Date.now()): Promise<LeisureToday> {
  const day = dayKeyOf(now)
  const [starRow, fishRow, riddleRow, enabled] = await Promise.all([
    readRow(userId, day, 'star'),
    readRow(userId, day, 'fish'),
    readRow(userId, day, 'riddle'),
    leisureEnabled()
  ])
  const basket = parseBasket(fishRow.payload)
  const { q, options } = riddleOfDay(day)
  return {
    enabled,
    day,
    now,
    secsToNext: secsToNextDay(now),
    star: { drawn: starRow.tries > 0, fortune: starRow.tries > 0 ? fortuneView(userId, day) : null },
    fish: { casts: fishRow.tries, max: MAX_CASTS, basket: basket.reward, caught: basket.caught, claimed: fishRow.claimed === 1 },
    riddle: {
      q,
      options,
      answered: riddleRow.tries > 0,
      correct: riddleRow.tries > 0 ? riddleRow.value === 1 : null,
      note: riddleRow.tries > 0 ? RIDDLES[riddleIndexOf(day)]!.note : null
    }
  }
}

/* ---------------- 三则 ---------------- */

export interface StarResult {
  fortune: FortuneView
  /** 首次抽签才发赏;重复请求给 already=true 且赏为零 */
  reward: LeisureReward
  already: boolean
}

/** 抽签:一日一签,抽过再点只回看,不再发赏 */
export async function drawStar(userId: number, now = Date.now()): Promise<StarResult> {
  const day = dayKeyOf(now)
  const row = await readRow(userId, day, 'star')
  const fortune = fortuneView(userId, day)
  if (row.tries > 0) return { fortune, reward: ZERO(), already: true }
  await writeRow(userId, day, 'star', { tries: 1, value: fortune.index, payload: '', claimed: true })
  return { fortune, reward: { ...fortune.reward }, already: false }
}

/** 掷一竿:按权重抽,入篓;次数用尽返回 null */
export async function castLine(
  userId: number,
  now = Date.now()
): Promise<{ catch: { id: string; label: string; reward: LeisureReward }; basket: LeisureReward; caught: string[]; casts: number; max: number } | null> {
  const day = dayKeyOf(now)
  const row = await readRow(userId, day, 'fish')
  if (row.tries >= MAX_CASTS) return null
  if (row.claimed === 1) return null
  const basket = parseBasket(row.payload)
  const pick = rollCatch()
  const next: Basket = {
    reward: merge(basket.reward, pick.reward),
    caught: [...basket.caught, pick.label]
  }
  await writeRow(userId, day, 'fish', {
    tries: row.tries + 1,
    value: 0,
    payload: JSON.stringify(next),
    claimed: false
  })
  return {
    catch: { id: pick.id, label: pick.label, reward: { ...ZERO(), ...pick.reward } },
    basket: next.reward,
    caught: next.caught,
    casts: row.tries + 1,
    max: MAX_CASTS
  }
}

function rollCatch(): Catch {
  const total = CATCHES.reduce((s, c) => s + c.weight, 0)
  let r = Math.random() * total
  for (const c of CATCHES) {
    r -= c.weight
    if (r <= 0) return c
  }
  return CATCHES[0]!
}

/** 收篓:把今日累计收获一次交给客户端;已收或空篓返回 null */
export async function claimBasket(userId: number, now = Date.now()): Promise<LeisureReward | null> {
  const day = dayKeyOf(now)
  const row = await readRow(userId, day, 'fish')
  if (row.claimed === 1) return null
  const basket = parseBasket(row.payload)
  const empty =
    basket.reward.stone + basket.reward.herb + basket.reward.wudao + basket.reward.ore + basket.reward.dust + basket.reward.page === 0
  // 空篓也允一次「收」:把次数与篓清掉,免得界面一直挂着,但无赏
  await writeRow(userId, day, 'fish', { tries: row.tries, value: 0, payload: '', claimed: true })
  return empty ? ZERO() : basket.reward
}

export interface RiddleAnswer {
  correct: boolean
  /** 正确答案下标,答后才给 */
  answer: number
  note: string
  reward: LeisureReward
  already: boolean
}

/** 答谜:一问一次,答过不再改;答对给赏,答错给一句安慰 */
export async function answerRiddle(userId: number, choice: number, now = Date.now()): Promise<RiddleAnswer | null> {
  const day = dayKeyOf(now)
  const idx = riddleIndexOf(day)
  const r = RIDDLES[idx]!
  const row = await readRow(userId, day, 'riddle')
  if (row.tries > 0) {
    return { correct: row.value === 1, answer: r.answer, note: r.note, reward: ZERO(), already: true }
  }
  if (!Number.isInteger(choice) || choice < 0 || choice >= r.options.length) return null
  const correct = choice === r.answer
  const reward: LeisureReward = correct ? { ...ZERO(), stone: 120, wudao: 8, page: 2 } : { ...ZERO(), stone: 20 }
  await writeRow(userId, day, 'riddle', { tries: 1, value: correct ? 1 : 2, payload: '', claimed: correct })
  return { correct, answer: r.answer, note: r.note, reward, already: false }
}
