/**
 * 成就库 —— 62 个
 * 未达成者界面一律显示「???」(见 views/CollectionView.vue),此表无隐藏成就。
 */
import type { AchievementDef, AchvCond, CounterKey, RewardBundle } from '@/types'

function counter(key: CounterKey, value: number): AchvCond {
  return { type: 'counter', key, value }
}

function ac(id: string, name: string, desc: string, cond: AchvCond, reward?: RewardBundle): AchievementDef {
  return { id, name, desc, cond, reward }
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // ---- 境界 ----
  ac('a_r0', '初窥仙途', '首次踏入炼气境', { type: 'realm', major: 0 }, { stoneTier: 20, titleId: 'ti_churu' }),
  ac('a_r1', '筑基修士', '突破筑基境', { type: 'realm', major: 1 }, { stoneTier: 40, wudao: 10, titleId: 'ti_zhuji' }),
  ac('a_r2', '金丹得道', '突破金丹境', { type: 'realm', major: 2 }, { stoneTier: 60, wudao: 20, titleId: 'ti_jindan' }),
  ac('a_r3', '元婴出窍', '突破元婴境', { type: 'realm', major: 3 }, { stoneTier: 80, wudao: 30, titleId: 'ti_yuanying' }),
  ac('a_r4', '神游太虚', '突破化神境', { type: 'realm', major: 4 }, { stoneTier: 100, wudao: 40, titleId: 'ti_huashen' }),
  ac('a_r5', '返虚合道', '突破炼虚境', { type: 'realm', major: 5 }, { stoneTier: 120, wudao: 50, titleId: 'ti_lianxu' }),
  ac('a_r6', '天人合一', '突破合体境', { type: 'realm', major: 6 }, { stoneTier: 140, wudao: 60, titleId: 'ti_heti' }),
  ac('a_r7', '大道将成', '突破大乘境', { type: 'realm', major: 7 }, { stoneTier: 160, wudao: 80, titleId: 'ti_dacheng' }),
  ac('a_r8', '雷海渡厄', '突破渡劫境', { type: 'realm', major: 8 }, { stoneTier: 200, wudao: 100, titleId: 'ti_dujie' }),
  ac('a_r9', '得证仙位', '飞升真仙境', { type: 'realm', major: 9 }, { stoneTier: 300, wudao: 200, titleId: 'ti_zhenxian' }),
  // ---- 仙界及以上 ----
  ac('a_r10', '玄之又玄', '突破玄仙境', { type: 'realm', major: 10 }, { stoneTier: 340, wudao: 240, titleId: 'ti_xuanxian' }),
  ac('a_r11', '金性不朽', '突破金仙境', { type: 'realm', major: 11 }, { stoneTier: 380, wudao: 300, titleId: 'ti_jinxian' }),
  ac('a_r12', '太乙近道', '突破太乙境', { type: 'realm', major: 12 }, { stoneTier: 420, wudao: 360, titleId: 'ti_taiyi' }),
  ac('a_r13', '大罗逍遥', '突破大罗境', { type: 'realm', major: 13 }, { stoneTier: 460, wudao: 420, titleId: 'ti_daluo' }),
  ac('a_r14', '神光照世', '踏入神界,证得神人境', { type: 'realm', major: 14 }, { stoneTier: 520, wudao: 500, titleId: 'ti_shenren' }),
  ac('a_r15', '代天行罚', '突破神将境', { type: 'realm', major: 15 }, { stoneTier: 580, wudao: 580, titleId: 'ti_shenjiang' }),
  ac('a_r16', '神域之主', '突破神王境', { type: 'realm', major: 16 }, { stoneTier: 640, wudao: 660, titleId: 'ti_shenwang' }),
  ac('a_r17', '神帝临尘', '突破神帝境', { type: 'realm', major: 17 }, { stoneTier: 720, wudao: 760, titleId: 'ti_shendi' }),
  ac('a_r18', '混沌真灵', '踏入混沌海,证得混沌真灵', { type: 'realm', major: 18 }, { stoneTier: 820, wudao: 880, titleId: 'ti_hundunling' }),
  ac('a_r19', '开天辟地', '突破混沌神魔,神魔一体', { type: 'realm', major: 19 }, { stoneTier: 940, wudao: 1000, titleId: 'ti_hundunshenmo' }),
  ac('a_r20', '万道之祖', '证道混沌道祖,与混沌同寿', { type: 'realm', major: 20 }, { stoneTier: 1200, wudao: 1300, titleId: 'ti_daozu' }),
  // ---- 突破 ----
  ac('a_bt10', '拾级而上', '累计突破 10 次', counter('breakthroughs', 10), { stoneTier: 30 }),
  ac('a_bt30', '道途不辍', '累计突破 30 次', counter('breakthroughs', 30), { wudao: 20 }),
  ac('a_bt60', '百折不挠', '累计突破 60 次', counter('breakthroughs', 60), { wudao: 40 }),
  ac('a_btf5', '道阻且长', '突破失败 5 次', counter('breakthroughFails', 5), { herb: 20 }),
  ac('a_trib3', '劫后余生', '渡过 3 次天劫', counter('tribulations', 3), { wudao: 30 }),
  // ---- 战斗 ----
  ac('a_k50', '初试锋芒', '击败 50 个敌人', counter('kills', 50), { stoneTier: 25 }),
  ac('a_k300', '身经百战', '击败 300 个敌人', counter('kills', 300), { stoneTier: 50, titleId: 'ti_slayer' }),
  ac('a_k1000', '千军辟易', '击败 1000 个敌人', counter('kills', 1000), { stoneTier: 100 }),
  ac('a_k5000', '伏尸百万', '击败 5000 个敌人', counter('kills', 5000), { stoneTier: 200 }),
  ac('a_boss10', '一剑破万法', '击败 10 位区域首领', counter('bossKills', 10), { titleId: 'ti_wanfa', wudao: 30 }),
  ac('a_boss20', '横扫诸域', '击败 20 位区域首领', counter('bossKills', 20), { stoneTier: 150 }),
  // ---- 装备 ----
  ac('a_eq10', '初有积蓄', '累计获得 10 件装备', counter('equipsGained', 10), { dust: 10 }),
  ac('a_eq100', '琳琅满目', '累计获得 100 件装备', counter('equipsGained', 100), { dust: 50 }),
  ac('a_eq500', '藏宝千件', '累计获得 500 件装备', counter('equipsGained', 500), { dust: 200 }),
  ac('a_q4', '玄光初现', '获得一件玄品或更高装备', { type: 'quality', rank: 4 }, { stoneTier: 40 }),
  ac('a_q6', '天命之子', '获得一件天品或更高装备', { type: 'quality', rank: 6 }, { titleId: 'ti_tianjiao', stoneTier: 80 }),
  ac('a_q7', '仙缘深厚', '获得一件仙品或更高装备', { type: 'quality', rank: 7 }, { stoneTier: 120 }),
  ac('a_q8', '神物自晦', '获得一件神品装备', { type: 'quality', rank: 8 }, { stoneTier: 200 }),
  ac('a_up30', '小有心得', '累计强化 30 次', counter('upgrades', 30), { dust: 30 }),
  ac('a_up100', '百炼成钢', '累计强化 100 次', counter('upgrades', 100), { titleId: 'ti_baolian', dust: 80 }),
  ac('a_dec50', '化繁为简', '分解 50 件装备', counter('decomposed', 50), { dust: 60 }),
  // ---- 历练 ----
  ac('a_ex10', '行万里路', '完成 10 次历练', counter('explores', 10), { stoneTier: 30 }),
  ac('a_ex50', '踏遍山河', '完成 50 次历练', counter('explores', 50), { stoneTier: 80 }),
  ac('a_ev20', '际遇非凡', '经历 20 次际遇', counter('events', 20), { wudao: 15 }),
  ac('a_ev100', '缘法自来', '经历 100 次际遇', counter('events', 100), { wudao: 50 }),
  // ---- 丹药 ----
  ac('a_pill20', '以药辅道', '服用 20 枚丹药', counter('pillsUsed', 20), { herb: 30 }),
  ac('a_pill100', '丹药如饭', '服用 100 枚丹药', counter('pillsUsed', 100), { herb: 100 }),
  ac('a_craft30', '开炉有喜', '炼制 30 枚丹药', counter('pillsCrafted', 30), { herb: 50 }),
  ac('a_craft100', '丹道圣手', '炼制 100 枚丹药', counter('pillsCrafted', 100), { titleId: 'ti_danwang' }),
  // ---- 功法 ----
  ac('a_gf5', '博采众长', '习得 5 部功法', counter('gongfaLearned', 5), { page: 20 }),
  ac('a_gf15', '一览道藏', '习得 15 部功法', counter('gongfaLearned', 15), { page: 60, wudao: 30 }),
  // ---- 洞府 ----
  ac('a_bd10', '安家立业', '累计升级建筑 10 次', counter('buildingUpgrades', 10), { stoneTier: 40 }),
  ac('a_bd40', '洞天福地', '累计升级建筑 40 次', counter('buildingUpgrades', 40), { stoneTier: 120 }),
  // ---- 转世 ----
  ac('a_re1', '一世轮回', '完成第一次转世', counter('reincarnations', 1), { titleId: 'ti_zhuanshi', wudao: 50 }),
  ac('a_re3', '三生三世', '完成三次转世', counter('reincarnations', 3), { wudao: 150 }),
  // ---- 离线 ----
  ac('a_off5', '归来有成', '领取 5 次离线收益', counter('offlineClaims', 5), { stoneTier: 30 }),
  ac('a_off30', '常归常往', '领取 30 次离线收益', counter('offlineClaims', 30), { stoneTier: 100 }),
  // ---- 特殊 ----
  ac('a_lifelow', '寿元将尽', '寿元只剩不到一成', { type: 'custom', key: 'lifespanLow' }, { herb: 50 }),
  ac('a_lifespan', '万古长生', '寿元上限超过一万载', { type: 'custom', key: 'lifespan10k' }, { titleId: 'ti_changsheng' }),
  ac('a_rich', '富可敌国', '持有灵石超过一百万', { type: 'custom', key: 'stone1m' }, { wudao: 30 }),
  // 「炼气修士」称号的获取路径(删掉则该称号无来源)
  ac('a_lianqi_full', '炼气圆满', '炼气境修至圆满', { type: 'custom', key: 'realm_0_9' }, { stoneTier: 30, titleId: 'ti_lianqi' })
]
