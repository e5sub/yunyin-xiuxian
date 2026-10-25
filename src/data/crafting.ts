/**
 * 百工技艺谱:做什么长什么,无职业/加点/转职;技艺分项计量,无单一等级。
 * 技艺(做得到)与知识(知道怎么做)分开,知识在 stores/lore.ts 的认知度里
 */
import type { PillDef } from '@/types'
import { MATERIALS, type MaterialDef } from './materials'

export type SkillId =
  // 识材道(炼丹炼器共用)
  | 'discern'
  // 炼丹道
  | 'herbLore'
  | 'pairing'
  | 'condense'
  | 'temper'
  | 'nurture'
  // 灵火道(共用)
  | 'flame'
  // 炼器道
  | 'smithing'
  | 'inscribe'

export type DaoId = 'shicai' | 'liandan' | 'linghuo' | 'lianqi'

export interface SkillDef {
  id: SkillId
  name: string
  dao: DaoId
  /** 玩家可见 */
  desc: string
}

export const DAO_NAMES: Record<DaoId, string> = {
  shicai: '识材道',
  liandan: '炼丹道',
  linghuo: '灵火道',
  lianqi: '炼器道'
}

export const SKILLS: SkillDef[] = [
  { id: 'discern', name: '识材', dao: 'shicai', desc: '认出眼前是什么灵材' },
  { id: 'herbLore', name: '辨药', dao: 'liandan', desc: '通晓药性寒热与毒理' },
  { id: 'pairing', name: '配伍', dao: 'liandan', desc: '定君臣佐使,调和相冲药性' },
  { id: 'condense', name: '凝丹', dao: 'liandan', desc: '聚散乱药力为丹形' },
  { id: 'temper', name: '淬药', dao: 'liandan', desc: '逼出杂质,提纯药力' },
  { id: 'nurture', name: '养丹', dao: 'liandan', desc: '温养护持,压住残毒' },
  { id: 'flame', name: '控火', dao: 'linghuo', desc: '引火、控温、护炉' },
  { id: 'smithing', name: '锻打', dao: 'lianqi', desc: '千锤定形,逼出材质本性' },
  { id: 'inscribe', name: '铭纹', dao: 'lianqi', desc: '刻纹引灵,使器通灵' }
]

export const SKILL_IDS = SKILLS.map(s => s.id)

const SKILL_BY_ID = new Map(SKILLS.map(s => [s.id, s]))

export function skillDef(id: SkillId): SkillDef | undefined {
  return SKILL_BY_ID.get(id)
}

// ============ 熟练度曲线 ============

/** 累积经验 → 熟练度 0~100:双曲饱和,永不到顶 */
export const SKILL_EXP_SCALE = 600

export function skillLevelFromExp(exp: number): number {
  const e = Math.max(0, exp)
  return (100 * e) / (e + SKILL_EXP_SCALE)
}

/** 技艺境地分档;界面显示分档名,不显示裸数字 */
const SKILL_STAGES: readonly { min: number; name: string }[] = [
  { min: 94, name: '大成' },
  { min: 85, name: '通玄' },
  { min: 72, name: '精通' },
  { min: 58, name: '娴熟' },
  { min: 40, name: '小成' },
  { min: 25, name: '入门' },
  { min: 10, name: '初识' },
  { min: 0, name: '生疏' }
]

export function skillStageName(level: number): string {
  return SKILL_STAGES.find(s => level >= s.min)?.name ?? '生疏'
}

// ============ 丹方工艺表 ============

export interface RecipeCraft {
  /** 丹方阶位 1~9;超出可承受阶位仍可炼,只是极难 */
  rank: number
  /** 君臣佐使,首味为君药 */
  materials: readonly string[]
  /** 各技艺权重,和为 1 */
  skills: Readonly<Partial<Record<SkillId, number>>>
}

/** 有特写工艺的丹方,其余按下方规则推导 */
const CRAFT_OVERRIDES: Readonly<Record<string, Partial<RecipeCraft>>> = {
  p_pojing: { skills: { condense: 0.4, flame: 0.22, pairing: 0.18, herbLore: 0.1, temper: 0.1 } },
  p_xuanming: { materials: ['mat_xuanyin', 'mat_hansui', 'mat_jiuye'], skills: { pairing: 0.38, herbLore: 0.24, nurture: 0.2, flame: 0.18 } },
  p_yanshou: { skills: { nurture: 0.36, temper: 0.24, condense: 0.16, herbLore: 0.14, flame: 0.1 } },
  p_qianshou: { skills: { nurture: 0.36, temper: 0.24, condense: 0.16, herbLore: 0.14, flame: 0.1 } },
  p_wanshou: { skills: { nurture: 0.34, temper: 0.26, condense: 0.18, herbLore: 0.12, flame: 0.1 } },
  p_pofudan: { materials: ['mat_youming', 'mat_chiyan', 'mat_qingzhi'], skills: { herbLore: 0.34, nurture: 0.26, pairing: 0.22, flame: 0.18 } },
  p_jiuzhuan: {
    materials: ['mat_taixushen', 'mat_jiuye', 'mat_leixin', 'mat_youming'],
    skills: { condense: 0.24, temper: 0.2, pairing: 0.2, flame: 0.18, nurture: 0.18 }
  },
  // ---- 神/道品丹方 ----
  p_taiyi: {
    materials: ['mat_taiyi', 'mat_taixushen', 'mat_jiuye'],
    skills: { condense: 0.32, flame: 0.24, temper: 0.2, pairing: 0.14, herbLore: 0.1 }
  },
  p_shenlian: {
    materials: ['mat_leixin', 'mat_taixushen', 'mat_jiuye'],
    skills: { flame: 0.34, temper: 0.24, condense: 0.18, pairing: 0.14, herbLore: 0.1 }
  },
  p_shenshi: {
    materials: ['mat_youming', 'mat_taixushen', 'mat_zihenlan'],
    skills: { pairing: 0.3, nurture: 0.26, herbLore: 0.18, flame: 0.14, temper: 0.12 }
  },
  p_yiyuan: {
    materials: ['mat_taiyi', 'mat_taixushen', 'mat_jiuye'],
    skills: { condense: 0.34, flame: 0.22, temper: 0.2, pairing: 0.14, herbLore: 0.1 }
  },
  p_tiandao: {
    materials: ['mat_taixushen', 'mat_zihenlan', 'mat_jiuye'],
    skills: { nurture: 0.3, pairing: 0.26, temper: 0.2, condense: 0.14, flame: 0.1 }
  },
  p_wuliang: {
    materials: ['mat_jiuye', 'mat_taixushen', 'mat_zihenlan'],
    skills: { nurture: 0.36, temper: 0.24, condense: 0.16, herbLore: 0.14, flame: 0.1 }
  },
  p_daoye: {
    materials: ['mat_jiuye', 'mat_hansui', 'mat_taixushen'],
    skills: { condense: 0.3, pairing: 0.24, nurture: 0.2, flame: 0.16, temper: 0.1 }
  },
  p_daotai: {
    materials: ['mat_taiyi', 'mat_youming', 'mat_taixushen'],
    skills: { nurture: 0.3, pairing: 0.26, flame: 0.18, herbLore: 0.16, temper: 0.1 }
  },
  p_huntian: {
    materials: ['mat_taiyi', 'mat_leixin', 'mat_taixushen'],
    skills: { flame: 0.3, condense: 0.24, pairing: 0.2, temper: 0.16, herbLore: 0.1 }
  }
}

function deriveMaterials(rank: number): string[] {
  const herbs = MATERIALS.filter(x => x.bucket === 'herb').sort((a, b) => a.rank - b.rank)
  const pick = (target: number): MaterialDef => {
    const eligible = herbs.filter(x => x.rank <= target)
    return (eligible[eligible.length - 1] ?? herbs[0]!) as MaterialDef
  }
  const king = pick(rank)
  const minister = pick(Math.max(1, rank - 2))
  const assistant = herbs[0]!
  const ids = [king.id, minister.id, assistant.id]
  return [...new Set(ids)]
}

function deriveSkills(kind: PillDef['kind']): Partial<Record<SkillId, number>> {
  return kind === 'instant'
    ? { condense: 0.3, temper: 0.26, flame: 0.18, herbLore: 0.14, pairing: 0.12 }
    : { pairing: 0.3, nurture: 0.26, flame: 0.18, herbLore: 0.14, condense: 0.12 }
}

/** 取丹方工艺;alchemyLevel 读作丹方阶位,不是丹炉等级门槛 */
export function recipeCraft(def: PillDef): RecipeCraft | null {
  if (!def.recipe) return null
  const rank = Math.max(1, Math.min(9, def.alchemyLevel ?? 1))
  const ov = CRAFT_OVERRIDES[def.id]
  return {
    rank,
    materials: ov?.materials ?? deriveMaterials(rank),
    skills: ov?.skills ?? deriveSkills(def.kind)
  }
}
