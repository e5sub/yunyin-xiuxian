/**
 * 紫微斗数 —— 12 个宫位 · 14 主星(象义取用)
 *
 * 只取象义,不排命盘(不问玩家生辰):按灵根与轮回归属安星。
 * 与周易分工,不互相顶替:问卦主动、有代价、随机、有时限;命格被动、无代价、随转世重算、常驻。
 * 数值须低于问卦。
 */
import type { StatMods } from '@/types'

export type PalaceId =
  | 'ming'
  | 'xiongdi'
  | 'fuqi'
  | 'zinv'
  | 'caibo'
  | 'jie'
  | 'qianyi'
  | 'jiaoyou'
  | 'guanlu'
  | 'tianzhai'
  | 'fude'
  | 'fumu'

export interface PalaceDef {
  id: PalaceId
  /** 宫名 */
  name: string
  /** 此宫所主(一句话) */
  domain: string
  /** 落在此宫之星,给哪一路属性 */
  channel: string
  /** 此宫在游戏里管什么 */
  use: string
}

/** 十二宫 —— 依紫微斗数通行宫序(命宫起,逆布十二宫) */
export const PALACES: PalaceDef[] = [
  { id: 'ming', name: '命宫', domain: '一身之根本,性之所出', channel: '修行', use: '修炼速度与根基' },
  { id: 'xiongdi', name: '兄弟宫', domain: '同气与助力', channel: '同道', use: '师承与道侣之助' },
  { id: 'fuqi', name: '夫妻宫', domain: '相与相契', channel: '因缘', use: '道侣缘分之厚薄' },
  { id: 'zinv', name: '子女宫', domain: '生生与所养', channel: '灵兽', use: '灵兽与洞府所养' },
  { id: 'caibo', name: '财帛宫', domain: '财之所聚', channel: '财货', use: '灵石与掉落之丰' },
  { id: 'jie', name: '疾厄宫', domain: '身之强弱与所忌', channel: '道躯', use: '气血与抗劫' },
  { id: 'qianyi', name: '迁移宫', domain: '行止与远游', channel: '行旅', use: '历练在外之顺逆' },
  { id: 'jiaoyou', name: '交友宫', domain: '朋辈与部从', channel: '人脉', use: '际遇与机缘之数' },
  { id: 'guanlu', name: '官禄宫', domain: '功业与名位', channel: '征伐', use: '战阵攻伐之利' },
  { id: 'tianzhai', name: '田宅宫', domain: '所居与所积', channel: '洞府', use: '洞府产出与积蓄' },
  { id: 'fude', name: '福德宫', domain: '福泽与心之所安', channel: '福缘', use: '气运与心魔之扰' },
  { id: 'fumu', name: '父母宫', domain: '所承与所受', channel: '传承', use: '道统与传承之厚' }
]

export interface StarDef {
  id: string
  name: string
  /** 星性:紫微为帝、天机为智…… */
  nature: string
  /** 一句星义 */
  gist: string
  /** 此星所与之力 */
  mods: StatMods
}

/** 十四主星 —— 依紫微斗数所传十四正曜 */
export const STARS: StarDef[] = [
  { id: 'ziwei', name: '紫微', nature: '帝座', gist: '帝星居中而驭众,主尊贵与统摄。', mods: { breakthroughRate: 0.02, cultivationSpeed: 0.02 } },
  { id: 'tianji', name: '天机', nature: '智谋', gist: '机变善谋,主思虑与巧思。', mods: { cultivationSpeed: 0.03 } },
  { id: 'taiyang', name: '太阳', nature: '光明', gist: '普照无私,主名声与外显。', mods: { damageBonus: 0.02, luck: 0.02 } },
  { id: 'wuqu', name: '武曲', nature: '刚毅', gist: '财帛之曜,主刚决与实利。', mods: { attackPct: 0.02, dropRate: 0.02 } },
  { id: 'tiantong', name: '天同', nature: '和乐', gist: '福星柔和,主安泰与滋养。', mods: { maxHpPct: 0.03 } },
  { id: 'lianzhen', name: '廉贞', nature: '严明', gist: '化为囚气,主约束与规矩。', mods: { damageReduction: 0.02, defensePct: 0.02 } },
  { id: 'tianfu', name: '天府', nature: '库藏', gist: '南斗令星,主蓄积与安稳。', mods: { dropRate: 0.02, maxHpPct: 0.02 } },
  { id: 'taiyin', name: '太阴', nature: '柔润', gist: '月之精,主内敛与灵气之养。', mods: { qiRegen: 0.03 } },
  { id: 'tanlang', name: '贪狼', nature: '多欲', gist: '主进取与所求之广。', mods: { luck: 0.03 } },
  { id: 'jumen', name: '巨门', nature: '口舌', gist: '主言语与辨析,亦主争议。', mods: { critRate: 0.02, luck: 0.01 } },
  { id: 'tianxiang', name: '天相', nature: '辅弼', gist: '印星,主协和与成事。', mods: { defensePct: 0.03 } },
  { id: 'tianliang', name: '天梁', nature: '荫庇', gist: '荫星,主救护与逢凶化吉。', mods: { tribulationResist: 0.03 } },
  { id: 'qisha', name: '七杀', nature: '肃杀', gist: '将星,主威权与决断。', mods: { attackPct: 0.03 } },
  { id: 'pojun', name: '破军', nature: '破旧', gist: '主开路与开创。', mods: { speed: 0.02, damageBonus: 0.02 } }
]


