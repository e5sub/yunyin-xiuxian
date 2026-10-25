/**
 * 道侣共同事件
 *
 * 契合是行为结果,不是 API 参数:
 *   玩家行为计数 → playerLean() + 道侣道途 + 选择与道侣的诉求/底线是否相合 → 三维各自变化。
 * 玩家只看到道侣的反应,看不到「accord +5」。
 *
 * 边界:可改变关系、结局、道侣是否离开,不产出任何 StatMods / 资源 / 道果 / 宿慧。
 */
import type { CounterKey } from '@/types'
import { type DaoLean, type DaoluDef, type DaoluGender, bondText } from '@/data/daolu'

/** 关系冲突的类型 —— 每个事件各代表一种,不做重复 */
export type ConflictKind =
  /** 资源冲突:只有一份 */
  | 'resource'
  /** 道途冲突:救还是杀 */
  | 'path'
  /** 风险冲突:陪道侣冒险还是拦住道侣 */
  | 'risk'
  /** 价值观冲突:拿到它要伤及无辜 */
  | 'value'
  /** 人生目标:道侣要离开这条路线 */
  | 'pursuit'
  /** 共同承担:道侣救你要折损自己 */
  | 'sacrifice'
  /** 共命之险:两个人只够一个人先走 */
  | 'mortal'

/** 一个选项对三维的影响 —— 由与道侣相合与否决定,不是固定数值 */
export interface BondOutcome {
  /** 缘分:共历本身 */
  fate: number
  /** 信任:道侣敢不敢把事交给你 */
  trust: number
  /** 契合:你们是不是同一种人 */
  accord: number
  /** 道侣因此离开 */
  leaves?: boolean
  /** 事件后的叙述 */
  text: string
}

export interface BondChoice {
  id: string
  label: string
  /** 选项体现的道途,与道侣的道途比对后决定契合走向;null 表示不涉及道途判断 */
  lean: DaoLean | null
  /** 是否触碰道侣的底线 */
  crossesTaboo?: boolean
  /** 是否兑现了对道侣的支持 */
  supportsHer?: boolean
  risky?: boolean
  /**
   * 共命之险:道侣的生死由 daoluService 判定(信任与契合都够则同生,不够则道侣殒落)。
   * 唯一会死人的选项;label 里必须写出代价。
   */
  peril?: boolean
  outcome: Omit<BondOutcome, 'text'> & { text: string }
}

/** 事件发生的时机 —— 由历练情境决定,不是定时器 */
export type BondTrigger =
  /** 踏入一处新地界 */
  | 'enterPlace'
  /** 在该地界首次获胜 */
  | 'firstVictory'
  /** 击破该地界首领 */
  | 'bossDefeated'
  /** 濒死或败退 */
  | 'nearDeath'

export const TRIGGER_NAMES: Record<BondTrigger, string> = {
  enterPlace: '踏入新地界',
  firstVictory: '首胜之后',
  bossDefeated: '击破首领',
  nearDeath: '濒死之际'
}

export interface BondEventDef {
  id: string
  kind: ConflictKind
  title: string
  /** 事件背景 */
  text: string
  /** 道侣在本事件的具体诉求(语气由 DaoluDef.pursuit 填充) */
  herWish: string
  /** 道侣的底线 */
  herLimit: string
  /** 至少到这一阶才会发生 */
  minStageIndex: number
  /** 触发时机;空数组等于「随时」,须避免 */
  triggers: readonly BondTrigger[]
  choices: BondChoice[]
  /** 满足条件时道侣先表态,玩家只能在「尊重/说服/独行」之间选 */
  sheDecides?: { when: 'lowTrust' | 'lowAccord' | 'cautious'; line: string }
}

function c(
  id: string,
  label: string,
  lean: DaoLean | null,
  outcome: BondChoice['outcome'],
  opts: Partial<Pick<BondChoice, 'crossesTaboo' | 'supportsHer' | 'risky' | 'peril'>> = {}
): BondChoice {
  return { id, label, lean, outcome, ...opts }
}

export const BOND_EVENTS: BondEventDef[] = [
  {
    id: 'be_relic',
    kind: 'resource',
    title: '遗府',
    text: '你与{ta}循着塌了半边的石阶下到底层。案上一卷丹方,更深处的石匣里另有一件法宝,机关将合,只够取走一样。',
    herWish: '{ta}想要那卷丹方,已经找了很久',
    herLimit: '{ta}不会为了法宝眼睁睁看你去死',
    minStageIndex: 2,
    triggers: ['bossDefeated'],
    choices: [
      c('take_recipe', '取丹方,依{ta}所愿', 'alchemy', {
        fate: 4,
        trust: 12,
        accord: 6,
        text: '{ta}把丹方收进袖中,没有说谢,但那之后你说的话{ta}都听得很认真。'
      }),
      c(
        'take_artifact',
        '取法宝,丹方作罢',
        'artifice',
        {
          fate: 3,
          trust: -14,
          accord: -8,
          text: '{ta}看着石匣合上,什么也没说。回程路上{ta}一直走在你身后半步。'
        },
        { crossesTaboo: true }
      ),
      c(
        'take_both',
        '两样都要',
        null,
        {
          fate: 6,
          trust: -4,
          accord: -2,
          text: '机关落下时{ta}替你挡了一记。丹方到手,法宝碎了半边,{ta}的左臂三日不能抬。'
        },
        { risky: true }
      )
    ]
  },
  {
    id: 'be_spare',
    kind: 'path',
    title: '刀下',
    text: '一名重伤的散修跪在你们面前。他方才还在设伏,如今只求活命。',
    herWish: '{ta}希望留那人一条命',
    herLimit: '{ta}不看着人被杀',
    minStageIndex: 2,
    triggers: ['firstVictory'],
    choices: [
      c('spare', '放他走', 'longevity', {
        fate: 3,
        trust: 6,
        accord: 8,
        text: '那人踉跄着消失在林子里。{ta}说:「不是每个人都该死在今天。」'
      }),
      c(
        'kill',
        '斩草除根',
        'slaughter',
        {
          fate: 2,
          trust: -8,
          accord: -12,
          text: '你收剑时{ta}已经转过身去。这一路{ta}再没主动开口。'
        },
        { crossesTaboo: true }
      ),
      c('leave', '不管他,径自离去', null, {
        fate: 1,
        trust: 0,
        accord: -1,
        text: '你们谁也没回头。那人是死是活,后来都无人提起。'
      })
    ]
  },
  {
    id: 'be_lead',
    kind: 'risk',
    title: '线索',
    text: '{ta}在一处断碑上认出了旧年的刻痕。往深处走或许有{ta}要找的东西,那里的凶险却不好说。',
    herWish: '{ta}想进去看看',
    herLimit: '{ta}不愿因自己的事把别人拖下水',
    minStageIndex: 2,
    triggers: ['enterPlace'],
    choices: [
      c(
        'accompany',
        '陪{ta}进去',
        null,
        {
          fate: 8,
          trust: 15,
          accord: 4,
          text: '深处什么也没有,只有一面塌了的墙。{ta}在墙前站了很久,出来时说:「多谢。」'
        },
        { supportsHer: true, risky: true }
      ),
      c('dissuade', '劝{ta}别去', 'longevity', {
        fate: 2,
        trust: -6,
        accord: -3,
        text: '{ta}点头说好,却记住了那个位置。'
      }),
      c(
        'alone',
        '你自己进去,让{ta}在外面等',
        null,
        {
          fate: 3,
          trust: 4,
          accord: -4,
          text: '你带回半块碑文。{ta}道了谢,却没接过去看:「这是我该自己走的一段。」'
        },
        { risky: true }
      )
    ]
  },
  {
    id: 'be_price',
    kind: 'value',
    title: '代价',
    text: '要取得那味药引,须惊动山下一整座村子的地脉。药引能救{ta}的伤,村子会因此薄收三年。',
    herWish: '{ta}宁可自己扛着伤',
    herLimit: '{ta}不肯让别人替{ta}付代价',
    minStageIndex: 3,
    triggers: ['bossDefeated'],
    choices: [
      c('forgo', '作罢,另寻他法', 'truth', {
        fate: 4,
        trust: 8,
        accord: 14,
        text: '{ta}笑了一下:「这才像你。」'
      }),
      c(
        'take',
        '取药引,救{ta}要紧',
        'alchemy',
        {
          fate: 5,
          trust: 6,
          accord: -16,
          text: '伤是好了。{ta}后来常望着山下的方向出神,没再提过这件事。'
        },
        { crossesTaboo: true }
      ),
      c('ask', '让{ta}自己决定', null, {
        fate: 3,
        trust: 10,
        accord: 5,
        text: '{ta}想了很久,说不要。'
      })
    ]
  },
  {
    id: 'be_depart',
    kind: 'pursuit',
    title: '岔路',
    text: '{ta}说要往北去了,与你这一世的路线相反。{ta}要找的人可能在那里。',
    herWish: '{ta}想去完成自己的事',
    herLimit: '{ta}不肯让人为{ta}改道',
    minStageIndex: 3,
    triggers: ['enterPlace'],
    sheDecides: { when: 'lowAccord', line: '{ta}已经收好了行囊,像是不打算商量。' },
    choices: [
      c(
        'follow',
        '陪{ta}走这一趟',
        null,
        {
          fate: 12,
          trust: 18,
          accord: 8,
          text: '你们绕了很远,{ta}要找的人不在那里。归途中,{ta}说起了那人的旧事。'
        },
        { supportsHer: true, risky: true }
      ),
      c(
        'stop',
        '拦下{ta}',
        null,
        {
          fate: 2,
          trust: -12,
          accord: -10,
          text: '{ta}留下了,却不再提北边的事。'
        },
        { crossesTaboo: true }
      ),
      c('part_ways', '各走各的路', null, {
        fate: 0,
        trust: -2,
        accord: 6,
        leaves: true,
        text: '{ta}说:「你我本就不是一条道上的人,这样也好。」然后头也不回地走了。'
      })
    ]
  },
  {
    id: 'be_rescue',
    kind: 'sacrifice',
    title: '重伤',
    text: '你伤得很重。{ta}有一枚能救你的丹,攒了三年,原是留着突破用的。',
    herWish: '{ta}已经把丹药握在手里了',
    herLimit: '{ta}不喜欢欠人情,也不喜欢别人欠{ta}',
    minStageIndex: 3,
    triggers: ['nearDeath'],
    sheDecides: { when: 'lowTrust', line: '{ta}犹豫了一下,把丹药收了回去。' },
    choices: [
      c('accept', '受了{ta}这枚丹', null, {
        fate: 10,
        trust: 12,
        accord: 2,
        text: '{ta}的境界因此停在原处两年。这件事你们谁都没再提。'
      }),
      c(
        'refuse',
        '推开{ta}的手',
        'longevity',
        {
          fate: 6,
          trust: -4,
          accord: 10,
          text: '你自己熬了过来。{ta}说:「你这个人,真是。」'
        },
        { supportsHer: true }
      ),
      c('trade', '要{ta}记下这份人情', null, {
        fate: 4,
        trust: -10,
        accord: -6,
        text: '{ta}把丹给了你,也把这句话记下了。此后{ta}待你客气了许多。'
      })
    ]
  },
  {
    id: 'be_jie',
    kind: 'mortal',
    title: '共劫',
    text: '这一劫来得比你们预料的早。退路已断,两人只够一人先走,或者一起从中间蹚过去。',
    herWish: '{ta}说:「一起走吧。」语气很平。',
    herLimit: '{ta}怕拖累别人;你若把{ta}推开,{ta}会记很久',
    minStageIndex: 4,
    triggers: ['nearDeath', 'bossDefeated'],
    choices: [
      c(
        'share',
        '与{ta}同担此劫({ta}未必撑得住)',
        null,
        {
          fate: 8,
          trust: 6,
          accord: 8,
          text: '两道身影一同撞进劫云里。'
        },
        { risky: true, peril: true, supportsHer: true }
      ),
      c('shield', '替{ta}挡下这一击', 'longevity', {
        fate: 10,
        trust: 18,
        accord: 10,
        text: '你把{ta}按在身后,自己迎了上去。{ta}念了一遍你的名字。'
      }),
      c('send', '让{ta}先走', null, {
        fate: 2,
        trust: -12,
        accord: -6,
        text: '{ta}被推向生路,回头看了你一眼。'
      })
    ]
  }
]

export function bondEventDef(id: string): BondEventDef | undefined {
  return BOND_EVENTS.find(e => e.id === id)
}

/** 上屏用:事件里所有文案按道侣性别换好代词(返回新对象) */
export function bondEventView(ev: BondEventDef, gender: DaoluGender): BondEventDef {
  const t = (s: string): string => bondText(s, gender)
  return {
    ...ev,
    title: t(ev.title),
    text: t(ev.text),
    herWish: t(ev.herWish),
    herLimit: t(ev.herLimit),
    choices: ev.choices.map(c => ({ ...c, label: t(c.label), outcome: { ...c.outcome, text: t(c.outcome.text) } })),
    ...(ev.sheDecides ? { sheDecides: { ...ev.sheDecides, line: t(ev.sheDecides.line) } } : {})
  }
}

// ============ 玩家道途:由行为推断,不是设定 ============

/** 各道途对应的行为计数 */
export const LEAN_COUNTERS: Record<DaoLean, readonly CounterKey[]> = {
  slaughter: ['kills', 'bossKills'],
  longevity: ['breakthroughs', 'tribulations'],
  sword: ['battles', 'upgrades'],
  alchemy: ['pillsCrafted', 'pillsUsed'],
  artifice: ['equipsGained', 'decomposed'],
  truth: ['gongfaLearned', 'events']
}

/** 归一量纲:各道途行为的典型量级 */
const LEAN_SCALE: Record<DaoLean, number> = {
  slaughter: 300,
  longevity: 30,
  sword: 400,
  alchemy: 40,
  artifice: 60,
  truth: 40
}

/** 由行为计数推断玩家实际在走的道:取归一后最高的一条,都很低时返回 null */
export function leanFromCounters(counter: (k: CounterKey) => number): DaoLean | null {
  let best: DaoLean | null = null
  let bestScore = 0
  for (const [lean, keys] of Object.entries(LEAN_COUNTERS) as [DaoLean, readonly CounterKey[]][]) {
    const raw = keys.reduce((s, k) => s + counter(k), 0)
    const score = raw / LEAN_SCALE[lean]
    if (score > bestScore) {
      bestScore = score
      best = lean
    }
  }
  return bestScore >= 0.15 ? best : null
}

// ============ 选择的后果 ============

export function resolveChoice(
  def: DaoluDef,
  choice: BondChoice,
  playerLean: DaoLean | null
): BondOutcome & { leanShift: number } {
  const o = choice.outcome
  // 选项体现的道途与道侣的道途是否相合
  const tension: Partial<Record<DaoLean, DaoLean>> = {
    slaughter: 'longevity',
    longevity: 'slaughter',
    sword: 'alchemy',
    alchemy: 'sword'
  }
  let leanShift = 0
  if (choice.lean) {
    if (choice.lean === def.lean) leanShift = 6
    else leanShift = tension[def.lean] === choice.lean ? -8 : -2
  }
  /** 玩家一贯的道途也参与契合:三档须各有区别,否则不同道途的玩家做同一个选择契合相同 */
  if (playerLean) {
    if (playerLean === def.lean) leanShift += 3
    else if (tension[def.lean] === playerLean) leanShift -= 5
    else leanShift -= 1
  }
  return {
    fate: o.fate,
    trust: o.trust + (choice.supportsHer ? 4 : 0) + (choice.crossesTaboo ? -6 : 0),
    accord: o.accord + leanShift,
    leaves: o.leaves,
    text: o.text,
    leanShift
  }
}

/** 道侣是否会自己先做决定 */
export function sheDecidesNow(
  def: BondEventDef,
  bond: { trust: number; accord: number },
  temper: string
): string | null {
  if (!def.sheDecides) return null
  const w = def.sheDecides.when
  if (w === 'lowTrust' && bond.trust < 40) return def.sheDecides.line
  if (w === 'lowAccord' && bond.accord < 45) return def.sheDecides.line
  if (w === 'cautious' && temper === 'cautious') return def.sheDecides.line
  return null
}
