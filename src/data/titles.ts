/** 称号 —— 由成就解锁,可佩戴一枚 */
import type { TitleDef } from '@/types'

export const TITLES: TitleDef[] = [
  { id: 'ti_churu', name: '初入仙途', desc: '踏出修行第一步', mods: { cultivationSpeed: 0.02 } },
  { id: 'ti_lianqi', name: '炼气修士', desc: '于炼气境站稳脚跟', mods: { cultivationSpeed: 0.03 } },
  { id: 'ti_zhuji', name: '筑基真人', desc: '筑就大道之基', mods: { cultivationSpeed: 0.04, maxHpPct: 0.03 } },
  { id: 'ti_jindan', name: '金丹老祖', desc: '丹成之日,山呼海啸', mods: { cultivationSpeed: 0.05, attackPct: 0.04 } },
  { id: 'ti_yuanying', name: '元婴大能', desc: '元婴一出,谁与争锋', mods: { cultivationSpeed: 0.06, breakthroughRate: 0.01 } },
  { id: 'ti_slayer', name: '百兽辟易', desc: '斩妖除魔数百计', mods: { attackPct: 0.06 } },
  { id: 'ti_wanfa', name: '一剑破万法', desc: '击败十位区域之主', mods: { attackPct: 0.08, critRate: 0.02 } },
  { id: 'ti_tianjiao', name: '天命之人', desc: '获得一件天品以上装备', mods: { luck: 0.05, dropRate: 0.04 } },
  { id: 'ti_baolian', name: '百炼成钢', desc: '强化装备百次', mods: { defensePct: 0.06 } },
  { id: 'ti_danwang', name: '丹道圣手', desc: '炼丹百炉不辍', mods: { alchemyYield: 0.1 } },
  { id: 'ti_zhuanshi', name: '轮回行者', desc: '历经一次轮回', mods: { cultivationSpeed: 0.05, expGain: 0.05 } },
  { id: 'ti_changsheng', name: '万古长生', desc: '寿元逾万载', mods: { lifespanPct: 0.1 } },
  // ---- 境界称号:每一大境界一顶 ----
  { id: 'ti_huashen', name: '化神真人', desc: '神念化形,言出法随', mods: { cultivationSpeed: 0.05, qiRegen: 0.05 } },
  { id: 'ti_lianxu', name: '炼虚道君', desc: '炼神返虚,窥见大道', mods: { cultivationSpeed: 0.05, damageReduction: 0.03 } },
  { id: 'ti_heti', name: '合体真君', desc: '身道相合,举念移山', mods: { cultivationSpeed: 0.06, maxHpPct: 0.05 } },
  { id: 'ti_dacheng', name: '大乘尊者', desc: '大道将成,静候天命', mods: { cultivationSpeed: 0.06, attackPct: 0.05 } },
  { id: 'ti_dujie', name: '渡劫行者', desc: '九重雷海,向死而生', mods: { cultivationSpeed: 0.06, tribulationResist: 0.05 } },
  // ---- 界域里程碑称号 ----
  { id: 'ti_zhenxian', name: '得证仙位', desc: '飞升仙界,证得真仙', mods: { cultivationSpeed: 0.06, qiRegen: 0.06 } },
  { id: 'ti_xuanxian', name: '玄仙真人', desc: '仙体玄妙,一念山河', mods: { cultivationSpeed: 0.06, luck: 0.04 } },
  { id: 'ti_jinxian', name: '金仙道尊', desc: '金性不朽,历劫不磨', mods: { cultivationSpeed: 0.06, damageBonus: 0.05 } },
  { id: 'ti_taiyi', name: '太乙上人', desc: '太乙近道,万法归流', mods: { cultivationSpeed: 0.07, breakthroughRate: 0.01 } },
  { id: 'ti_daluo', name: '大罗真人', desc: '大罗金仙,逍遥三界', mods: { cultivationSpeed: 0.07, maxHpPct: 0.05 } },
  { id: 'ti_shenren', name: '神域之主', desc: '破界入神,位列神人', mods: { attackPct: 0.06, maxHpPct: 0.05 } },
  { id: 'ti_shenjiang', name: '天罚神将', desc: '执掌神兵,代天行罚', mods: { cultivationSpeed: 0.07, critRate: 0.02 } },
  { id: 'ti_shenwang', name: '神王御宇', desc: '神域之主,言出法随', mods: { cultivationSpeed: 0.08, defensePct: 0.06 } },
  { id: 'ti_shendi', name: '神帝独尊', desc: '神帝临尘,众神俯首', mods: { cultivationSpeed: 0.08, damageReduction: 0.04 } },
  { id: 'ti_hundunling', name: '混沌真灵', desc: '混沌初开,一点真灵不昧', mods: { cultivationSpeed: 0.08, qiRegen: 0.08 } },
  { id: 'ti_hundunshenmo', name: '开天神魔', desc: '神魔一体,开天辟地', mods: { cultivationSpeed: 0.09, attackPct: 0.07 } },
  { id: 'ti_daozu', name: '万道之祖', desc: '证道混沌道祖,与混沌同寿', mods: { cultivationSpeed: 0.08, breakthroughRate: 0.015 } },
  // ---- 本源八境 ----
  { id: 'ti_hunyuan', name: '混元一气', desc: '一气含万有,聚散由心', mods: { cultivationSpeed: 0.09, attackPct: 0.06 } },
  { id: 'ti_wuji', name: '无极无终', desc: '无始无终,无内无外', mods: { cultivationSpeed: 0.09, dodgeRate: 0.02 } },
  { id: 'ti_taiji', name: '太极两仪', desc: '一划既开,两仪相生', mods: { cultivationSpeed: 0.1, attackPct: 0.05, defensePct: 0.05 } },
  { id: 'ti_taisu', name: '太素质始', desc: '质之始也,有形皆备', mods: { cultivationSpeed: 0.1, maxHpPct: 0.06 } },
  { id: 'ti_taishi', name: '太始形初', desc: '形未成而先有其端', mods: { cultivationSpeed: 0.11, speed: 0.05 } },
  { id: 'ti_taichu', name: '太初气始', desc: '气之始也,含而不发', mods: { cultivationSpeed: 0.11, qiRegen: 0.1 } },
  { id: 'ti_hongmeng', name: '鸿蒙未判', desc: '浑然一体,无可破之处', mods: { cultivationSpeed: 0.12, damageReduction: 0.05 } },
  { id: 'ti_daoyuan', name: '道源无极', desc: '先天地生,为万法之源', mods: { cultivationSpeed: 0.13, breakthroughRate: 0.02 } }
]

const BY_ID = new Map(TITLES.map(x => [x.id, x]))

export function titleDef(id: string): TitleDef | undefined {
  return BY_ID.get(id)
}
