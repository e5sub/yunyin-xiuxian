/**
 * 奇门遁甲 —— 九宫与 8 个门(择门而入)
 *
 * 与契约(换道源倍数)、变数(随机规则)分工:八门免费,择一或走常道,只改这一趟的打法,不碰道源倍数。
 * 效果只用既有 CombatRules 字段,不新造;未择门的远征规则不变(审计基线不受影响)。
 */
import type { CombatRules } from '@/types'

export type GateId = 'xiu' | 'sheng' | 'shang' | 'du' | 'jing9' | 'si' | 'jing7' | 'kai'

export interface GateDef {
  id: GateId
  /** 单字门名 */
  name: string
  fullName: string
  /** 所居之卦与方位 */
  gua: string
  direction: string
  /** 洛书宫位(1~9;中五无门) */
  palace: number
  /** 吉门稳、凶门险而利,平门居中 */
  kind: '吉' | '平' | '凶'
  /** 打法说明 */
  desc: string
  /** 八门本义(来历) */
  gist: string
  rules: CombatRules
}

export const GATES: GateDef[] = [
  {
    id: 'xiu',
    name: '休',
    fullName: '休门',
    gua: '坎',
    direction: '北',
    palace: 1,
    kind: '吉',
    desc: '每三回合回一口气,但敌人攻势更盛 —— 拖得住,才拖得起',
    gist: '休门主休养安息,「休」非止而不动,是以静制动、以逸待劳。',
    rules: { perRounds: { interval: 3, playerHealPct: 0.06, playerShieldPct: 0, enemyAtkGrowth: 0.05 } }
  },
  {
    id: 'sheng',
    name: '生',
    fullName: '生门',
    gua: '艮',
    direction: '东北',
    palace: 8,
    kind: '吉',
    desc: '治疗与吸血效率大增,但出手稍钝 —— 以长气磨短兵',
    gist: '生门主生机萌发,万物由此而生,故为八门中最吉之门。',
    rules: { healMult: 1.4, playerAtkMult: 0.95 }
  },
  {
    id: 'shang',
    name: '伤',
    fullName: '伤门',
    gua: '震',
    direction: '东',
    palace: 3,
    kind: '凶',
    desc: '攻势大增,但每场以八五成气血开战 —— 先手伤人,也先受其伤',
    gist: '伤门主杀伤,震为雷动,利于争先而不利于久持。',
    rules: { playerAtkMult: 1.15, playerStartHpPct: 0.85 }
  },
  {
    id: 'du',
    name: '杜',
    fullName: '杜门',
    gua: '巽',
    direction: '东南',
    palace: 4,
    kind: '平',
    desc: '敌我攻势俱减 —— 关起门来打,谁也攻不动谁',
    gist: '杜门主闭塞隐匿,「杜」者塞也,善守者藏于九地之下。',
    rules: { playerAtkMult: 0.9, enemyAtkMult: 0.9 }
  },
  {
    id: 'jing9',
    name: '景',
    fullName: '景门',
    gua: '离',
    direction: '南',
    palace: 9,
    kind: '平',
    desc: '暴击大涨,敌人气血也更厚 —— 扬名者众矢之的',
    gist: '景门主彰显,离为火明,宜扬名显功,不宜藏锋。',
    rules: { playerExtraMods: { critRate: 0.08 }, enemyHpMult: 1.08 }
  },
  {
    id: 'si',
    name: '死',
    fullName: '死门',
    gua: '坤',
    direction: '西南',
    palace: 2,
    kind: '凶',
    desc: '己身攻势极盛、敌人也更凶更厚,回合更少 —— 背水一战',
    gist: '死门主死丧刑戮,凶中之凶;置之死地而后生者,亦在此门。',
    rules: { playerAtkMult: 1.25, enemyAtkMult: 1.2, enemyHpMult: 1.15, maxRounds: 20 }
  },
  {
    id: 'jing7',
    name: '惊',
    fullName: '惊门',
    gua: '兑',
    direction: '西',
    palace: 7,
    kind: '凶',
    desc: '十五回合内见生死,攻势更急 —— 一惊而起,速战速决',
    gist: '惊门主惊恐震荡,兑为口舌;事起仓促,唯迅疾者可全。',
    rules: { playerAtkMult: 1.2, maxRounds: 15 }
  },
  {
    id: 'kai',
    name: '开',
    fullName: '开门',
    gua: '乾',
    direction: '西北',
    palace: 6,
    kind: '吉',
    desc: '回复稍利、敌方攻势稍缓 —— 通达无阻,却也无奇',
    gist: '开门主开通顺遂,乾为天;吉门中最平正,不取巧者行之。',
    rules: { healMult: 1.25, enemyAtkMult: 0.95 }
  }
]

const GATE_BY_ID = new Map<string, GateDef>(GATES.map(g => [g.id, g]))

export function gateDef(id: string): GateDef | undefined {
  return GATE_BY_ID.get(id)
}
