/**
 * 敌人与灵宠的「族类 → 形」表,唯一事实源:数据里只写 `family`,形从这里取。
 * 一族共形;异族不共形(spec 钉:src/ui/beastFamilies.spec.ts,一枚图标被一个以上族类共用即红)。
 * lucide 没有蛇/龙/麒麟的专形,暂以波浪/云纹/幻城代。
 */
import type { BeastFamily } from '@/types'

export interface BeastFamilyDef {
  /** 族类名(写进注释与文档,不直接上界面) */
  name: string
  /** 本族共用的形,注册在 src/ui/icons.ts */
  icon: string
  /** 归入本族的范围,数据侧照此归类 */
  covers: string
}

export const BEAST_FAMILIES: Record<BeastFamily, BeastFamilyDef> = {
  // ---- 血肉走兽 ----
  beast: { name: '走兽', icon: 'paw', covers: '狼、猪、狐、熊、猿、猴、鹿、狸、鼠及四方神兽/异兽/凶兽/仙兽' },
  winged: { name: '羽禽', icon: 'bird', covers: '雀、鹰、鹤、鸾、鹏、蝙蝠 —— 有羽能飞者' },
  piscine: { name: '鱼鲛', icon: 'fish', covers: '鱼、鲛、鲨、游鱼、鬼鲛' },
  chelonian: { name: '龟', icon: 'turtle', covers: '龟;雪背小龟一类,背甲为形' },
  serpent: { name: '蛇蟒', icon: 'waves', covers: '蛇、蟒、九头蛇 —— 无角无足鳞虫' },
  dragon: { name: '龙属瑞兽', icon: 'cloud', covers: '蛟、螭龙、应龙、麒麟 —— 有角有鳞瑞兽' },
  verdant: { name: '草木', icon: 'leaf', covers: '藤木花草;噬人藤一类' },
  aqueous: { name: '水属', icon: 'droplets', covers: '水里的物事:泥怪、沼泽、海皇、渡厄仙槎(槎是舟,不是兽)' },

  // ---- 非血肉之躯 ----
  undead: { name: '骨骸', icon: 'skull', covers: '尸、骸、腐尸、行尸、沉尸 —— 留着躯壳没了魂的' },
  ghost: { name: '幽魂', icon: 'ghost', covers: '魂、鬼、影、残念、亡魂、恶鬼 —— 连躯壳都没了的' },
  construct: { name: '傀儡机关', icon: 'hammer', covers: '傀儡、俑、石像、神像、泥塑 —— 土木金石做出的人形' },
  blade: { name: '剑器', icon: 'sword', covers: '剑之属:剑灵、断剑、剑冢之主、枪灵' },

  // ---- 人形:按名目里的「魔/仙/神」分,不按强弱 ----
  armored: { name: '甲士', icon: 'shield', covers: '卫、兵、将、守卫、执事、卫士、骑士、斥候 —— 披甲执兵之士' },
  demon: { name: '妖魔', icon: 'wand', covers: '妖、魔:妖王、魔尊、妖圣、域主、罗刹、古魔、神魔' },
  immortal: { name: '仙人', icon: 'user', covers: '仙道:仙娥、仙翁、仙后、道童、道尊、仙子、道祖' },
  deity: { name: '神明', icon: 'crown', covers: '神:神王、神帝、天主、神官、守者、殿主、主宰' },

  // ---- 有专门名目的灵物 ----
  spirit: { name: '灵气', icon: 'sparkles', covers: '仙灵、真灵、游灵、本源、游影 —— 不是亡魂,是一缕灵气' },
  astral: { name: '星辰', icon: 'star', covers: '星光之属:星君、星主、星海 —— 星辰为主' },
  mirage: { name: '蜃象', icon: 'castle', covers: '海市蜃楼之属:蜃妖、蜃楼之主 —— 幻象做成的城' },
  outsider: { name: '天外', icon: 'orbit', covers: '自天外来的客;天外来客一类' },
  treasure: { name: '金玉', icon: 'gem', covers: '金玉之精:三足金蟾、帝印神兽' }
}

/** 族类取形;数据侧与渲染侧共用此入口 */
export function beastIcon(family: BeastFamily): string {
  return BEAST_FAMILIES[family].icon
}
