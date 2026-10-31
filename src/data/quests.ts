/** 主线任务链与每日任务 */
import type { QuestDef } from '@/types'

/** 主线任务:按顺序逐个推进,自动完成自动发奖 */
export const MAIN_QUESTS: QuestDef[] = [
  {
    id: 'q_start',
    name: '踏上仙途',
    desc: '突破至炼气三层',
    cond: { type: 'custom', key: 'realm_0_2' },
    reward: { stoneTier: 15, herb: 10 }
  },
  {
    id: 'q_explore',
    name: '初出茅庐',
    desc: '完成一次历练',
    cond: { type: 'counter', key: 'explores', value: 1 },
    reward: { stoneTier: 20, page: 6 }
  },
  {
    id: 'q_kill10',
    name: '斩妖除魔',
    desc: '击败 10 个敌人',
    cond: { type: 'counter', key: 'kills', value: 10 },
    reward: { stoneTier: 25, dust: 8 }
  },
  {
    id: 'q_equip',
    name: '披挂上阵',
    desc: '获得 5 件装备',
    cond: { type: 'counter', key: 'equipsGained', value: 5 },
    reward: { stoneTier: 25, dust: 10 }
  },
  {
    id: 'q_lianqi9',
    name: '炼气圆满',
    desc: '修至炼气圆满',
    cond: { type: 'custom', key: 'realm_0_9' },
    reward: { stoneTier: 40, herb: 20 }
  },
  { id: 'q_zhuji', name: '筑基问道', desc: '突破至筑基境', cond: { type: 'realm', major: 1 }, reward: { stoneTier: 60, wudao: 10 } },
  {
    id: 'q_gongfa',
    name: '博览道藏',
    desc: '习得 3 部功法',
    cond: { type: 'counter', key: 'gongfaLearned', value: 3 },
    reward: { page: 20, wudao: 8 }
  },
  {
    id: 'q_building',
    name: '经营洞府',
    desc: '累计升级建筑 5 次',
    cond: { type: 'counter', key: 'buildingUpgrades', value: 5 },
    reward: { stoneTier: 50, ore: 20 }
  },
  { id: 'q_pill', name: '丹道初窥', desc: '炼制 5 枚丹药', cond: { type: 'counter', key: 'pillsCrafted', value: 5 }, reward: { herb: 30 } },
  {
    id: 'q_boss3',
    name: '扫荡群妖',
    desc: '击败 3 位区域首领',
    cond: { type: 'counter', key: 'bossKills', value: 3 },
    reward: { stoneTier: 80, wudao: 15 }
  },
  { id: 'q_jindan', name: '金丹大道', desc: '突破至金丹境', cond: { type: 'realm', major: 2 }, reward: { stoneTier: 100, wudao: 25 } },
  {
    id: 'q_upgrade20',
    name: '千锤百炼',
    desc: '累计强化装备 20 次',
    cond: { type: 'counter', key: 'upgrades', value: 20 },
    reward: { dust: 40 }
  },
  { id: 'q_yuanying', name: '元婴之路', desc: '突破至元婴境', cond: { type: 'realm', major: 3 }, reward: { stoneTier: 150, wudao: 40 } },
  {
    id: 'q_boss10',
    name: '威震诸域',
    desc: '击败 10 位区域首领',
    cond: { type: 'counter', key: 'bossKills', value: 10 },
    reward: { stoneTier: 200, wudao: 50 }
  },
  { id: 'q_huashen', name: '问鼎化神', desc: '突破至化神境', cond: { type: 'realm', major: 4 }, reward: { stoneTier: 300, wudao: 80 } },

  // ---- 人间界后期 ----
  {
    id: 'q_boss20',
    name: '踏平妖庭',
    desc: '击败 20 位区域首领',
    cond: { type: 'counter', key: 'bossKills', value: 20 },
    reward: { stoneTier: 350, wudao: 90, dust: 60 }
  },
  { id: 'q_lianxu', name: '炼虚返真', desc: '突破至炼虚境', cond: { type: 'realm', major: 5 }, reward: { stoneTier: 420, wudao: 110 } },
  { id: 'q_heti', name: '身道相合', desc: '突破至合体境', cond: { type: 'realm', major: 6 }, reward: { stoneTier: 520, wudao: 140 } },
  { id: 'q_dacheng', name: '大道将成', desc: '突破至大乘境', cond: { type: 'realm', major: 7 }, reward: { stoneTier: 640, wudao: 180 } },
  { id: 'q_dujie', name: '九重雷海', desc: '突破至渡劫境', cond: { type: 'realm', major: 8 }, reward: { stoneTier: 800, wudao: 220 } },
  {
    id: 'q_zhenxian',
    name: '飞升仙界',
    desc: '飞升真仙境',
    cond: { type: 'realm', major: 9 },
    reward: { stoneTier: 1000, wudao: 300 }
  },
  // ---- 仙界 ----
  { id: 'q_xuanxian', name: '玄之又玄', desc: '突破至玄仙境', cond: { type: 'realm', major: 10 }, reward: { stoneTier: 1200, wudao: 360 } },
  { id: 'q_jinxian', name: '金性不朽', desc: '突破至金仙境', cond: { type: 'realm', major: 11 }, reward: { stoneTier: 1450, wudao: 430 } },
  { id: 'q_taiyi', name: '太乙近道', desc: '突破至太乙境', cond: { type: 'realm', major: 12 }, reward: { stoneTier: 1750, wudao: 520 } },
  { id: 'q_daluo', name: '大罗逍遥', desc: '突破至大罗境', cond: { type: 'realm', major: 13 }, reward: { stoneTier: 2100, wudao: 620 } },
  // ---- 神界 ----
  {
    id: 'q_shenren',
    name: '破界入神',
    desc: '证得神人境',
    cond: { type: 'realm', major: 14 },
    reward: { stoneTier: 2500, wudao: 750 }
  },
  { id: 'q_shenjiang', name: '代天行罚', desc: '突破至神将境', cond: { type: 'realm', major: 15 }, reward: { stoneTier: 2900, wudao: 900 } },
  { id: 'q_shenwang', name: '神域之主', desc: '突破至神王境', cond: { type: 'realm', major: 16 }, reward: { stoneTier: 3400, wudao: 1080 } },
  { id: 'q_shendi', name: '神帝临尘', desc: '突破至神帝境', cond: { type: 'realm', major: 17 }, reward: { stoneTier: 4000, wudao: 1300 } },
  // ---- 混沌海 ----
  {
    id: 'q_hundunling',
    name: '归返混沌',
    desc: '证得混沌真灵',
    cond: { type: 'realm', major: 18 },
    reward: { stoneTier: 4800, wudao: 1600 }
  },
  { id: 'q_hundunshenmo', name: '开天辟地', desc: '突破至混沌神魔境', cond: { type: 'realm', major: 19 }, reward: { stoneTier: 5700, wudao: 1950 } },
  {
    id: 'q_hundundaozu',
    name: '万道之祖',
    desc: '证道混沌道祖',
    cond: { type: 'realm', major: 20 },
    reward: { stoneTier: 7000, wudao: 2400 }
  },
  // ---- 本源 ----
  { id: 'q_hunyuan', name: '一气含万有', desc: '突破至混元境', cond: { type: 'realm', major: 21 }, reward: { stoneTier: 8600, wudao: 2900 } },
  { id: 'q_wuji', name: '无极而太极', desc: '突破至无极境', cond: { type: 'realm', major: 22 }, reward: { stoneTier: 10500, wudao: 3500 } },
  { id: 'q_taiji', name: '一划开天', desc: '突破至太极境', cond: { type: 'realm', major: 23 }, reward: { stoneTier: 13000, wudao: 4200 } },
  { id: 'q_taisu', name: '质之始', desc: '突破至太素境', cond: { type: 'realm', major: 24 }, reward: { stoneTier: 16000, wudao: 5000 } },
  { id: 'q_taishi', name: '形之始', desc: '突破至太始境', cond: { type: 'realm', major: 25 }, reward: { stoneTier: 19500, wudao: 6000 } },
  { id: 'q_taichu', name: '气之始', desc: '突破至太初境', cond: { type: 'realm', major: 26 }, reward: { stoneTier: 24000, wudao: 7200 } },
  { id: 'q_hongmeng', name: '浑然未判', desc: '突破至鸿蒙境', cond: { type: 'realm', major: 27 }, reward: { stoneTier: 29000, wudao: 8600 } },
  { id: 'q_daoyuan', name: '先天地生', desc: '证道道源,仙路至此为极', cond: { type: 'realm', major: 28 }, reward: { stoneTier: 35000, wudao: 10000 } }
]

export interface DailyTaskDef {
  id: string
  name: string
  desc: string
  counterKey: 'kills' | 'pillsUsed' | 'explores' | 'breakthroughs'
  target: number
  reward: QuestDef['reward']
}

/** 每日任务:按当日计数器增量结算 */
export const DAILY_TASKS: DailyTaskDef[] = [
  { id: 'd_kill', name: '每日斩妖', desc: '今日击败 15 个敌人', counterKey: 'kills', target: 15, reward: { stoneTier: 20 } },
  { id: 'd_pill', name: '每日服药', desc: '今日服用 1 枚丹药', counterKey: 'pillsUsed', target: 1, reward: { herb: 8 } },
  { id: 'd_explore', name: '每日历练', desc: '今日完成 1 次历练', counterKey: 'explores', target: 1, reward: { wudao: 4 } }
]
