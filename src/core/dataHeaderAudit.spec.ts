/** 数据表头计数审计:data/*.ts 头注释声明的规模数字须等于真实数组长度 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AFFIXES } from '@/data/affixes'
import { ARTIFACTS } from '@/data/artifacts'
import { EQUIPMENT_TEMPLATES } from '@/data/equipment'
import { TALENTS } from '@/data/talents'
import { ENEMIES } from '@/data/enemies'
import { BUILDINGS } from '@/data/buildings'
import { REGIONS } from '@/data/regions'
import { PILLS } from '@/data/pills'
import { ACHIEVEMENTS } from '@/data/achievements'
import { EVENTS } from '@/data/events'
import { CHAINS } from '@/data/chains'
import { TRIGRAMS } from '@/data/yijing'
import { PALACES } from '@/data/ziwei'
import { MANSIONS } from '@/data/xiangxiu'
import { GATES } from '@/data/qimen'
import { GONGFA } from '@/data/gongfa'
import { GONGFA_BRANCHES } from '@/data/gongfaBranches'
import { MAIN_QUESTS } from '@/data/quests'
import { MENTORS } from '@/data/mentors'
import { DAO_PATHS, CELESTIAL_WORLDS, TRIALS } from '@/data/endgame'
import { PACTS } from '@/data/pacts'
import { MUTATORS } from '@/data/mutators'
import { LIFE_THEMES } from '@/data/lifeThemes'
import { SAMSARA_STAGES } from '@/data/samsara'
import { REALMS, WORLDS } from '@/data/realms'
import { DAOLU } from '@/data/daolu'
import { FORTUNE_EVENTS } from '@/data/events'
import { TITLES } from '@/data/titles'
import { PETS } from '@/data/pets'

const SOURCES = import.meta.glob('../data/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** 文件名(相对 data/)→ 该文件导出数组的真实长度 */
const TABLES: { file: string; label: string; length: number }[] = [
  { file: 'affixes.ts', label: '词条', length: AFFIXES.length },
  { file: 'artifacts.ts', label: '法宝', length: ARTIFACTS.length },
  { file: 'equipment.ts', label: '装备模板', length: EQUIPMENT_TEMPLATES.length },
  { file: 'talents.ts', label: '天赋', length: TALENTS.length },
  { file: 'enemies.ts', label: '敌人', length: ENEMIES.length },
  { file: 'buildings.ts', label: '建筑', length: BUILDINGS.length },
  { file: 'regions.ts', label: '区域', length: REGIONS.length },
  { file: 'pills.ts', label: '丹药', length: PILLS.length },
  { file: 'achievements.ts', label: '成就', length: ACHIEVEMENTS.length },
  { file: 'events.ts', label: '随机事件(含奇缘阶段)', length: EVENTS.length },
  { file: 'chains.ts', label: '奇缘', length: CHAINS.length },
  { file: 'yijing.ts', label: '单卦', length: TRIGRAMS.length },
  { file: 'ziwei.ts', label: '宫', length: PALACES.length },
  { file: 'xiangxiu.ts', label: '星宿', length: MANSIONS.length },
  { file: 'qimen.ts', label: '门', length: GATES.length }
]

describe('数据表头计数 · 与真实数组长度一致', () => {
  it('头注释里写的规模,就是数组的实际长度', () => {
    for (const t of TABLES) {
      const raw = SOURCES[`../data/${t.file}`]
      expect(raw, `找不到数据文件 ${t.file}`).toBeTruthy()
      // 头注释:文件前 4 行里第一个「N 条/件/个/座/处/味」
      const head = raw!.split('\n').slice(0, 4).join('\n')
      const m = /(\d+)\s*(条|件|个|座|处|味)/.exec(head)
      expect(m, `${t.file} 的头注释里没有可核对的规模数字(${t.label})`).not.toBeNull()
      expect(Number(m![1]), `${t.file} 头注释写「${m![1]}」,实际 ${t.length} ${t.label}`).toBe(t.length)
    }
  })
})

/** README 数量对账:从表数出数,要求 README 里那句话长得一样;散文措辞可改,数字不可 */
describe('README · 数字与表一致', () => {
  const readme = readFileSync(resolve(__dirname, '../../README.md'), 'utf8')

  it('特色段里点名的数量,都能在表里数出来', () => {
    const claims: [string, string][] = [
      ['功法部数', `${GONGFA.length} 部功法`],
      ['悟道分支', `${GONGFA_BRANCHES.length} 条分支`],
      ['区域数', `${REGIONS.length} 个区域`],
      ['敌人数', `${ENEMIES.length} 种敌人`],
      ['随机事件', `${EVENTS.length} 个随机事件`],
      ['机缘类数', `${FORTUNE_EVENTS.length} 类机缘`],
      ['装备模板', `${EQUIPMENT_TEMPLATES.length} 种模板`],
      ['词条数', `${AFFIXES.length} 条词条`],
      ['法宝数', `${ARTIFACTS.length} 件法宝`],
      ['灵兽数', `${PETS.length} 只灵兽`],
      ['成就数', `${ACHIEVEMENTS.length} 个成就`],
      ['称号数', `${TITLES.length} 枚称号`]
    ]
    const missing = claims.filter(([, text]) => !readme.includes(text)).map(([what, text]) => `${what}: README 里找不到「${text}」`)
    expect(missing, missing.join('\n')).toEqual([])
  })

  it('系统一览表的每一行,数字也与表一致', () => {
    const rows: [string, string][] = [
      ['境界', `| 境界 | ${WORLDS.length} 界域 × ${REALMS.length} 境`],
      ['装备', `= ${EQUIPMENT_TEMPLATES.length} 模板`],
      ['功法', `| 功法 | ${GONGFA.length} 部（主修 / 辅修 / 秘术），圆满后开启 ${GONGFA_BRANCHES.length} 条悟道分支`],
      ['炼制', `| 炼制 | ${PILLS.length} 丹药 + ${ARTIFACTS.length} 法宝`],
      ['灵兽', `| 灵兽 | ${PETS.length} 只`],
      ['人缘', `| 人缘 | ${DAOLU.length} 位道侣 + ${MENTORS.length} 位师承`],
      ['轮回', `| 轮回 | ${SAMSARA_STAGES.length} 阶段积累见识，${LIFE_THEMES.length} 种人生主题`],
      ['终局', `| 终局 | ${DAO_PATHS.length} 道途 + ${CELESTIAL_WORLDS.length} 天界远征 + ${TRIALS.length} 试炼 + ${PACTS.length} 契约 + ${MUTATORS.length} 变数`],
      ['任务', `| 任务 | ${MAIN_QUESTS.length} 主线任务 + 每日任务 + ${ACHIEVEMENTS.length} 成就 + ${TITLES.length} 称号`]
    ]
    const missing = rows.filter(([, text]) => !readme.includes(text)).map(([what, text]) => `${what}: README 里找不到「${text}」`)
    expect(missing, missing.join('\n')).toEqual([])
  })
})
