/**
 * 道侣:关系值只转化为事件概率与选项资格,绝不进入效率链 ——
 *   不进 StatMods · 不兑换资源 · 不产道果 · 不产宿慧 · 不碰修炼速度
 * `daoluService.spec.ts` 用源码扫描强制这五条。进 StatMods 的永久出口都可达 cultivationSpeed(core/fruitOutlets.ts)。
 *
 * 三维关系,不是一根好感度;各管一件事,可以背离:
 *   缘分  相遇与共历的累积
 *   信任  道侣愿不愿意把自己的事交给你
 *   契合  两人对修行道路的根本理解是否一致
 */
import type { ElementId } from '@/types'

/** 道途倾向:共同选择上的偏向 */
export type DaoLean =
  | 'slaughter'
  | 'longevity'
  | 'sword'
  | 'alchemy'
  | 'artifice'
  | 'truth'

export const LEAN_NAMES: Record<DaoLean, string> = {
  slaughter: '杀伐',
  longevity: '长生',
  sword: '剑心',
  alchemy: '丹鼎',
  artifice: '器道',
  truth: '问心'
}

/** 行为倾向:共同历练时道侣会建议什么 */
export type Temperament =
  /** 遇险主张绕行 */
  | 'cautious'
  /** 更愿挑战高危 */
  | 'bold'
  /** 主张保存丹药灵材 */
  | 'frugal'
  /** 偏向未知与秘境 */
  | 'curious'

export const TEMPER_NAMES: Record<Temperament, string> = {
  cautious: '谨慎',
  bold: '激进',
  frugal: '惜物',
  curious: '好奇'
}

/** 性别:只决定上屏代词 */
export type DaoluGender = 'f' | 'm'

/** 道侣文本里指这位道侣的代词一律写它,上屏前经 bondText 换成 她/他 */
export const TA = '{ta}'

const PRONOUNS: Record<DaoluGender, string> = { f: '她', m: '他' }

/** 道侣文本的唯一渲染口 */
export function bondText(text: string, gender: DaoluGender): string {
  return text.split(TA).join(PRONOUNS[gender])
}

/** 道侣角色;刻意不设 mods 字段 */
export interface DaoluDef {
  id: string
  name: string
  gender: DaoluGender
  /** 一句人物速写 */
  brief: string
  temper: Temperament
  lean: DaoLean
  /** 灵根本源(影响相遇地界的偏好) */
  element: ElementId
  /** 初见时的境界(大境界序号) */
  startMajor: number
  /** 道侣自己要做的事(玩家可介入) */
  pursuit: string
  /** 道侣不肯越过的线;玩家逼近时契合下降 */
  taboo: string
  /** 相遇偏好的地貌轴;空表示随处可遇 */
  terrains: readonly string[]
}

function d(
  id: string,
  name: string,
  gender: DaoluGender,
  brief: string,
  temper: Temperament,
  lean: DaoLean,
  element: ElementId,
  startMajor: number,
  pursuit: string,
  taboo: string,
  terrains: readonly string[] = []
): DaoluDef {
  return { id, name, gender, brief, temper, lean, element, startMajor, pursuit, taboo, terrains }
}

/** 刻意无唯一最优对象:不同世界、道途、命题下各有合适与不合适(daoluService.spec.ts 检测) */
export const DAOLU: DaoluDef[] = [
  d(
    'dl_qingli',
    '沈青璃',
    'f',
    '寡言的女修,袖口常沾着药渣',
    'cautious',
    'alchemy',
    'wood',
    1,
    '寻找十年前失踪的师尊',
    '不喜杀伐,见人滥杀则远之',
    ['林泽', '山岳']
  ),
  d(
    'dl_zhaoyan',
    '赵砚',
    'm',
    '背一柄未开锋的铁剑,说要等它自己认主',
    'bold',
    'sword',
    'metal',
    2,
    '把那柄铁剑养到出鞘',
    '不肯用丹药抄近路',
    ['废墟', '山岳']
  ),
  d(
    'dl_muyan',
    '慕烟',
    'f',
    '走到哪里都在记录草木,笔比剑用得勤',
    'curious',
    'truth',
    'wood',
    1,
    '走遍此世每一处地界,把它记下来',
    '不愿为赶路而毁掉见到的东西',
    []
  ),
  d(
    'dl_hanzheng',
    '韩峥',
    'm',
    '旧战场上活下来的人,袖中永远有三把匕首',
    'bold',
    'slaughter',
    'dark',
    3,
    '找到当年灭{ta}满门的那个人',
    '受人恩惠必偿,欠债则寝食难安',
    ['废墟', '幽冥']
  ),
  d(
    'dl_yunshu',
    '云舒',
    'f',
    '总在打盹的散修,醒着的时候话很准',
    'frugal',
    'longevity',
    'water',
    2,
    '活得够久,久到看见一件事的结局',
    '厌恶把命押在一次豪赌上',
    ['林泽', '天象']
  ),
  d(
    'dl_ligu',
    '厉孤',
    'm',
    '独来独往的炼器师,十指有旧烫痕',
    'frugal',
    'artifice',
    'fire',
    2,
    '复原一件残缺的古器',
    '不许他人碰{ta}未成的器胚',
    ['火域', '废墟']
  ),
  d(
    'dl_baiwei',
    '白薇',
    'f',
    '医修出身,救人时手很稳,收钱时也很稳',
    'cautious',
    'alchemy',
    'water',
    1,
    '把一门失传的疗伤方子补全',
    '见死不救',
    ['林泽', '山岳']
  ),
  d(
    'dl_zhongli',
    '钟离越',
    'm',
    '前宗门执法,如今只信自己那一套规矩',
    'cautious',
    'truth',
    'earth',
    3,
    '查清当年宗门覆灭的真相',
    '不与背信者同行',
    ['废墟', '山岳']
  ),
  d(
    'dl_xuewu',
    '雪无痕',
    'f',
    '雪岭里长大的剑修,话少,出手更少但更狠',
    'bold',
    'sword',
    'ice',
    3,
    '在有生之年递出无悔的一剑',
    '不受嗟来之食',
    ['山岳', '天象']
  ),
  d(
    'dl_cangming',
    '苍冥',
    'm',
    '来历不明的修士,自称只是路过',
    'curious',
    'longevity',
    'chaos',
    4,
    '弄清自己为何会在这里醒来',
    '不谈来处,问急了便走',
    ['幽冥', '天象']
  )
]

export function daoluDef(id: string): DaoluDef | undefined {
  return DAOLU.find(x => x.id === id)
}

/** 人物卡上屏用:速写、所求、底线换好代词 */
export function daoluView(def: DaoluDef): DaoluDef {
  const t = (s: string): string => bondText(s, def.gender)
  return { ...def, brief: t(def.brief), pursuit: t(def.pursuit), taboo: t(def.taboo) }
}

// ============ 关系阶段 ============

/** 关系阶段:靠行为条件推进 */
export type BondStage =
  | 'none'
  | 'met'
  | 'known'
  | 'together'
  | 'confidant'
  | 'pledged'
  | 'daolv'

export const STAGE_NAMES: Record<BondStage, string> = {
  none: '素昧平生',
  met: '萍水相逢',
  known: '相识',
  together: '同行',
  confidant: '知交',
  pledged: '结契',
  daolv: '道侣'
}

export const STAGE_ORDER: readonly BondStage[] = ['none', 'met', 'known', 'together', 'confidant', 'pledged', 'daolv']

export function stageIndex(s: BondStage): number {
  return STAGE_ORDER.indexOf(s)
}

/** 推进到某阶所需的条件 */
export interface StageGate {
  stage: BondStage
  /** 最低缘分 */
  fate: number
  /** 最低信任 */
  trust: number
  /** 最低契合 */
  accord: number
  /** 需要的共历次数 */
  shared: number
  /** 条件的可读表述 */
  desc: string
}

/** 阶段门槛;契合(accord)到结契一步才成硬条件,契合低者可同行、可知交,结不了契 */
export const STAGE_GATES: readonly StageGate[] = [
  { stage: 'met', fate: 0, trust: 0, accord: 0, shared: 0, desc: '打过照面' },
  { stage: 'known', fate: 20, trust: 0, accord: 0, shared: 0, desc: '数次相遇,记住了彼此' },
  { stage: 'together', fate: 35, trust: 20, accord: 0, shared: 1, desc: '共历一次险境' },
  { stage: 'confidant', fate: 50, trust: 45, accord: 0, shared: 2, desc: '替{ta}了结过一桩事' },
  { stage: 'pledged', fate: 65, trust: 60, accord: 55, shared: 3, desc: '道心相印,立下共同的道' },
  { stage: 'daolv', fate: 80, trust: 75, accord: 65, shared: 4, desc: '结为道侣' }
]


/** 一世结束时的关系结局 */
export type BondEnding =
  | 'accompanied'
  | 'parted'
  | 'perished'
  | 'missed'

export const ENDING_NAMES: Record<BondEnding, string> = {
  accompanied: '相伴终老',
  parted: '分道扬镳',
  perished: '中道陨落',
  missed: '缘悭一面'
}
