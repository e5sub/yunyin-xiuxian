/**
 * 易 —— 8 个单卦(八卦) · 64 个重卦(六十四卦) · 卦辞大意与象数之用
 *
 * 出处:《周易》本经与《说卦》,不取后世附会;卦序卦名依通行本(王弼本)。
 * 重卦不逐条手写效果,由上下卦推出(core/divination)。
 */
import type { StatMods } from '@/types'

export type TrigramId = 'qian' | 'dui' | 'li' | 'zhen' | 'xun' | 'kan' | 'gen' | 'kun'

export interface TrigramDef {
  id: TrigramId
  /** 卦名:乾、兑、离、震、巽、坎、艮、坤 */
  name: string
  /** 卦画:☰ 等 */
  symbol: string
  /** 三爻自下而上(1 = 阳,0 = 阴),与 core/divination 取象同法 */
  lines: [number, number, number]
  /** 象:天、泽、火、雷、风、水、山、地 */
  image: string
  /** 性:健、说、丽、动、入、陷、止、顺 */
  nature: string
  /** 一句大意 */
  gist: string
  /** 宜:此卦所示该做之事 */
  good: string
  /** 忌:此卦所示该避之事 */
  bad: string
  /** 并入最终属性的环境通道;数值须偏小 */
  mods: StatMods
}

export const TRIGRAMS: TrigramDef[] = [
  {
    id: 'qian',
    name: '乾',
    symbol: '☰',
    lines: [1, 1, 1],
    image: '天',
    nature: '健',
    gist: '三爻皆阳,「天行健,君子以自强不息」。',
    good: '进取',
    bad: '骄盈',
    mods: { breakthroughRate: 0.06, cultivationSpeed: 0.08 }
  },
  {
    id: 'dui',
    name: '兑',
    symbol: '☱',
    lines: [1, 1, 0],
    image: '泽',
    nature: '说',
    gist: '泽润而悦,上下相说。',
    good: '交际',
    bad: '轻诺',
    mods: { luck: 0.08, dropRate: 0.06 }
  },
  {
    id: 'li',
    name: '离',
    symbol: '☲',
    lines: [1, 0, 1],
    image: '火',
    nature: '丽',
    gist: '火附于物而明,「明两作离」。',
    good: '扬名',
    bad: '燥烈',
    mods: { damageBonus: 0.08, critRate: 0.04 }
  },
  {
    id: 'zhen',
    name: '震',
    symbol: '☳',
    lines: [1, 0, 0],
    image: '雷',
    nature: '动',
    gist: '雷动,万物惊而后省。',
    good: '先手',
    bad: '妄动',
    mods: { speed: 0.08, counterRate: 0.05 }
  },
  {
    id: 'xun',
    name: '巽',
    symbol: '☴',
    lines: [0, 1, 1],
    image: '风',
    nature: '入',
    gist: '风行无所不入,「随风巽,君子以申命行事」。',
    good: '远行',
    bad: '随波',
    mods: { explorationSpeed: 0.1, dodgeRate: 0.04 }
  },
  {
    id: 'kan',
    name: '坎',
    symbol: '☵',
    lines: [0, 1, 0],
    image: '水',
    nature: '陷',
    gist: '水行于险而不失其信,「习坎,有孚维心亨」。',
    good: '蓄养',
    bad: '涉险',
    mods: { qiRegen: 0.12, damageReduction: 0.05 }
  },
  {
    id: 'gen',
    name: '艮',
    symbol: '☶',
    lines: [0, 0, 1],
    image: '山',
    nature: '止',
    gist: '山止而不迁,「艮其背,不获其身」。',
    good: '静守',
    bad: '固执',
    mods: { damageReduction: 0.08, tribulationResist: 0.05 }
  },
  {
    id: 'kun',
    name: '坤',
    symbol: '☷',
    lines: [0, 0, 0],
    image: '地',
    nature: '顺',
    gist: '三爻皆阴,地势厚而承物,「厚德载物」。',
    good: '守成',
    bad: '犹疑',
    mods: { maxHpPct: 0.08, defensePct: 0.06 }
  }
]

export interface HexagramDef {
  /** 通行本卦序(1~64) */
  order: number
  name: string
  /** 上卦(外) */
  upper: TrigramId
  /** 下卦(内) */
  lower: TrigramId
  /** 一句卦辞大意 */
  gist: string
}

function h(order: number, name: string, upper: TrigramId, lower: TrigramId, gist: string): HexagramDef {
  return { order, name, upper, lower, gist }
}

/** 六十四卦(通行本序) */
export const HEXAGRAMS: HexagramDef[] = [
  h(1, '乾', 'qian', 'qian', '六爻皆阳,天行至健;宜进取,忌骄盈。'),
  h(2, '坤', 'kun', 'kun', '六爻皆阴,厚德载物;宜守成,忌犹疑。'),
  h(3, '屯', 'kan', 'zhen', '云雷交作,万物始生;草创多艰。'),
  h(4, '蒙', 'gen', 'kan', '山下出泉,蒙昧未开;求教有则,再问则渎。'),
  h(5, '需', 'kan', 'qian', '云上于天,需而不进;待时而动,利涉大川。'),
  h(6, '讼', 'qian', 'kan', '天水违行,争讼之象;争则两伤,不如早止。'),
  h(7, '师', 'kun', 'kan', '地中有水,众聚为师;师出以律,无律则凶。'),
  h(8, '比', 'kan', 'kun', '水行地上,亲比相依;择善而从,去者不追。'),
  h(9, '小畜', 'xun', 'qian', '风行天上,密云不雨;小有积蓄。'),
  h(10, '履', 'qian', 'dui', '上天下泽,履虎尾而不咥;守礼而行,虽险无咎。'),
  h(11, '泰', 'kun', 'qian', '天地交而万物通;上下同心,其道大昌。'),
  h(12, '否', 'qian', 'kun', '天地不交而万物塞;宜守宜俭。'),
  h(13, '同人', 'qian', 'li', '天与火同明,与人同心;其利断金。'),
  h(14, '大有', 'li', 'qian', '火在天上,无所不照;所有既大,富有而顺。'),
  h(15, '谦', 'kun', 'gen', '地中有山,谦而不显;谦尊而光,卑而不可逾。'),
  h(16, '豫', 'zhen', 'kun', '雷出地奋,豫乐之作;乐极则溢,备豫则安。'),
  h(17, '随', 'dui', 'zhen', '泽中有雷,随时而动;随不失正,乃得其贞。'),
  h(18, '蛊', 'gen', 'xun', '山下有风,物腐生虫;整饬积弊,先难后治。'),
  h(19, '临', 'kun', 'dui', '泽上有地,临下以教;临事以诚,八月有凶。'),
  h(20, '观', 'xun', 'kun', '风行地上,观民设教;中正以观天下。'),
  h(21, '噬嗑', 'li', 'zhen', '雷电合章,噬嗑而合;决断刑罚,去梗则通。'),
  h(22, '贲', 'gen', 'li', '山下有火,贲饰其外;文饰之美,不可以尽信。'),
  h(23, '剥', 'gen', 'kun', '山附于地,剥落将尽;顺而止之,厚下安宅。'),
  h(24, '复', 'kun', 'zhen', '雷在地中,一阳来复;七日而复,往复其道。'),
  h(25, '无妄', 'qian', 'zhen', '天下雷行,物与无妄;不妄为则吉,妄则有灾。'),
  h(26, '大畜', 'gen', 'qian', '天在山中,大有蓄养;刚健笃实,日新其德。'),
  h(27, '颐', 'gen', 'zhen', '山下有雷,颐养之象;养正则吉,慎择所养。'),
  h(28, '大过', 'dui', 'xun', '泽灭木而栋桡;过甚之时,独立不惧。'),
  h(29, '坎', 'kan', 'kan', '重险相习,维心亨通;行险而不失信,乃能出险。'),
  h(30, '离', 'li', 'li', '明两作离,继明照于四方;附丽得正,乃得其明。'),
  h(31, '咸', 'dui', 'gen', '山上有泽,二气感应;感而遂通,虚己以受。'),
  h(32, '恒', 'zhen', 'xun', '雷风相与,恒久之道;立不易方。'),
  h(33, '遁', 'qian', 'gen', '天下有山,遁避之象;遁而时义大。'),
  h(34, '大壮', 'zhen', 'qian', '雷在天上,壮盛之时;壮而守正,非礼弗履。'),
  h(35, '晋', 'li', 'kun', '明出地上,晋而进升;自昭明德,进而有光。'),
  h(36, '明夷', 'kun', 'li', '明入地中,光明受伤;用晦而明,内其明也。'),
  h(37, '家人', 'xun', 'li', '风自火出,家道以立;言有物而行有恒。'),
  h(38, '睽', 'li', 'dui', '上火下泽,睽而相违;异中求同,小事乃吉。'),
  h(39, '蹇', 'kan', 'gen', '山上有水,蹇难之时;见险而止,反身修德。'),
  h(40, '解', 'zhen', 'kan', '雷雨作而百果解;险难既释,宜速宜早。'),
  h(41, '损', 'gen', 'dui', '山下有泽,损下益上;损而有孚,乃得大吉。'),
  h(42, '益', 'xun', 'zhen', '风雷相益,上益下而民悦;见善则迁,有过则改。'),
  h(43, '夬', 'dui', 'qian', '泽上于天,决而必行;刚决柔邪,不尚武力。'),
  h(44, '姤', 'qian', 'xun', '天下有风,不期而遇;遇合之初,不可与长。'),
  h(45, '萃', 'dui', 'kun', '泽上于地,聚而萃之;聚则必有备,除戎器戒不虞。'),
  h(46, '升', 'kun', 'xun', '地中生木,积小而升。'),
  h(47, '困', 'dui', 'kan', '泽无水而困;处困而言不信,唯以心自守。'),
  h(48, '井', 'kan', 'xun', '水风相与,井养不穷。'),
  h(49, '革', 'dui', 'li', '泽中有火,革故鼎新;己日乃孚,改命则吉。'),
  h(50, '鼎', 'li', 'xun', '木上有火,鼎烹饪以养;正位凝命,养贤为先。'),
  h(51, '震', 'zhen', 'zhen', '重雷相荐,震来虩虩;惊而后省,笑言哑哑。'),
  h(52, '艮', 'gen', 'gen', '两山相重,艮止其所;时止则止,时行则行。'),
  h(53, '渐', 'xun', 'gen', '山上有木,渐进而长;鸿渐于陆,循序乃得。'),
  h(54, '归妹', 'zhen', 'dui', '泽上有雷,归妹之象;情动而失序,往则有咎。'),
  h(55, '丰', 'zhen', 'li', '雷电皆至,丰大之极;日中则昃,宜及时而照。'),
  h(56, '旅', 'li', 'gen', '山上有火,行旅之象;旅而无所容,唯柔顺得安。'),
  h(57, '巽', 'xun', 'xun', '两风相重,申命行事;柔皆顺乎刚,利有攸往。'),
  h(58, '兑', 'dui', 'dui', '两泽相连,和悦讲习;悦以先民,民忘其劳。'),
  h(59, '涣', 'xun', 'kan', '风行水上,涣散之象;涣而不散其道,乃可济难。'),
  h(60, '节', 'kan', 'dui', '泽上有水,节以制度;节而不苦,乃得其甘。'),
  h(61, '中孚', 'xun', 'dui', '泽上有风,中孚以信;信及豚鱼,乃可涉川。'),
  h(62, '小过', 'zhen', 'gen', '山上有雷,小有过越;可小事不可大事,宜下不宜上。'),
  h(63, '既济', 'kan', 'li', '水在火上,既济之功;初吉终乱,思患而预防。'),
  h(64, '未济', 'li', 'kan', '火在水上,未济之象;事未成而慎终,如濡其尾。')
]

/** 动爻数 → 卦力 / 时长档位 */
export const CHANGING_TIERS: { min: number; power: number; minutes: number; note: string }[] = [
  { min: 0, power: 1, minutes: 45, note: '六爻不动,卦静;力缓,可久。' },
  { min: 1, power: 1.25, minutes: 30, note: '一二爻动,事有转机;力稍盛,时机稍急。' },
  { min: 3, power: 1.5, minutes: 15, note: '三爻以上皆动,事变在即;卦力最盛,时机最急。' }
]

const TRIGRAM_BY_ID = new Map(TRIGRAMS.map(t => [t.id, t]))
const HEXAGRAM_BY_PAIR = new Map(HEXAGRAMS.map(x => [`${x.upper}/${x.lower}`, x]))

export function trigramDef(id: TrigramId): TrigramDef | undefined {
  return TRIGRAM_BY_ID.get(id)
}

/** 上下卦相叠取重卦 */
export function hexagramOf(upper: TrigramId, lower: TrigramId): HexagramDef | undefined {
  return HEXAGRAM_BY_PAIR.get(`${upper}/${lower}`)
}

/** 三爻取象:自下而上的三条爻 → 单卦 */
export function trigramOfLines(lines: [number, number, number]): TrigramDef | undefined {
  return TRIGRAMS.find(t => t.lines[0] === lines[0] && t.lines[1] === lines[1] && t.lines[2] === lines[2])
}
