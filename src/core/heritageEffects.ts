/**
 * 宿命传承效果落地:已锻得的传承占哪个能力位、改变什么(锻造生命周期在 core/heritageForge)。
 * 全部纯函数:输入只有已持传承 id 与每世用量,不读 store、不读时间。
 * 红线(见 data/heritage):效果须是有界、平直的能力位,不随道果 / 世数无界增长;每世只消费一次的归 heritageUses,跨世不带。
 */
import type { HeritageId } from '@/data/heritage'

/** 每世炼丹必成炉数(浴火丹心);0 = 未持有 */
export function craftGuaranteeCrafts(owned: readonly HeritageId[]): number {
  return owned.includes('danxin') ? 3 : 0
}

/** 浴火丹心本世剩余必成炉数;craftPill 真开炉时读取并消费(见 core/pillService),用量跨世不带 */
export function craftGuaranteeRemaining(
  owned: readonly HeritageId[],
  uses: Readonly<Record<string, number>> | undefined
): number {
  const max = craftGuaranteeCrafts(owned)
  if (max <= 0) return 0
  const used = uses?.danxin ?? 0
  return Math.max(0, max - used)
}

/** 转世出生的起始境界下限(major):元婴凝实为筑基(1),否则炼气(0);player.rebirth 出生时把 major 抬到此下限 */
export function birthMajorFloor(owned: readonly HeritageId[]): number {
  return owned.includes('yuanying') ? 1 : 0
}

/** 转世择先天之姿多一个可选项(炼虚通感):三选一 → 四选一 */
export function talentChoiceBonus(owned: readonly HeritageId[]): number {
  return owned.includes('tonggan') ? 1 : 0
}

/** 已习功法等级全留(大乘道统):转世交割时不折回起手 */
export function keepsAllGongfa(owned: readonly HeritageId[]): boolean {
  return owned.includes('daotong')
}

/** 突破失败豁免(渡劫跬步):每世一次 */
export function hasBreakExemption(owned: readonly HeritageId[]): boolean {
  return owned.includes('dubu')
}

/** 认知按最高档全带(真仙道痕):认得所有灵材,不受本世境界限制 */
export function carriesAllLore(owned: readonly HeritageId[]): boolean {
  return owned.includes('daoben')
}
