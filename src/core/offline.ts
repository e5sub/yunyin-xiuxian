/**
 * 离线结算 —— 「归来」系统
 * 与在线 Tick 共用同一套公式,按封顶时长折算收益
 */
import type { EventDef, OfflineSummary } from '@/types'
import { add, gn, gnZero, isZero, mulN, sub } from '@/utils/gnum'
import { formatDuration, formatGN } from '@/utils/format'
import { offlineAgeNote, offlineArtifactNote, offlineBossNoteText } from '@/ui/offlineText'
import { breakthroughReadyNote } from '@/ui/cultivationText'
import { rng } from '@/utils/random'
import { regionDef } from '@/data/regions'
import { HERB_GRADES, herbGradeOfMajor } from '@/data/herbGrades'
import { enemyDef } from '@/data/enemies'
import { buffDef } from '@/data/buffs'
import {
  AGE_YEARS_PER_HOUR,
  BATTLE_EXP_SECS,
  EQUIP_DROP_CHANCE,
  EQUIP_DROP_CHANCE_CAP,
  HERB_DROP_CHANCE,
  ORE_DROP_CHANCE,
  ARTIFACT_DROP_CHANCE,
  PAGE_DROP_CHANCE,
  PILL_DROP_CHANCE,
  EXPLORE_MODES,
  INSTANT_EXP_LAYER_CAP,
  OFFLINE_BOSS_REWARD_MULT,
  OFFLINE_EFFICIENCY,
  OFFLINE_FLAT_DUST_PER_WIN,
  OFFLINE_MODAL_MIN_SECONDS
} from '@/data/constants'
import { makeEnemySnap, resolveCombat, sampleWinRate } from './combat'
import { buildPlayerSnap } from './playerSnap'
import { generateEquipment } from './equipGen'
import { onAcquire, acquireArtifactGain, acquireEquipment, afterWin, randomDropArtifact, randomDropPill } from './loot'
import { avgDustPerDrop } from './economySim'
import { autoResolveEvent, regionEventPoolFor } from './eventEngine'
import {
  clearRegionAndUnlockNext,
  exploreEventChance,
  exploreBattleGapSec,
  regionBossCleared,
  dangerFactorFor,
  explorationRules,
  winsUntilRegionBoss
} from './exploration'
import { currentRegionEvent, regionEventDef } from './regionEvent'
import { placeContent } from './mortalWorldService'
import { expFromSecs, stoneByTier } from './formulas'
import { breakthroughInfo } from './breakthrough'
import { checkSuppression, settleSuppressedRegions, suppressRateLine } from './suppress'
import { gainBondOpportunities } from './daoluService'
import { harvestMaterials, noteEnemy, noteEnemyMany, studyTick } from './loreService'
import { recordLossBatch, isNemesis, markAvenged, regionRecallFor, NEMESIS_THRESHOLD } from './worldMemory'
import { noteTaboo, vowResult } from './samsaraService'
import { modOf, capChance } from './statsCalc'
import { personalityEffects } from './petPersonality'
import { recordWinStreakBatch } from './earlyGameService'
import { streakRewardText } from '@/ui/streakText'
import { collect, track } from './progress'
import { equipmentTemplate } from '@/data/equipment'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useInventoryStore } from '@/stores/inventory'
import { useDongfuStore } from '@/stores/dongfu'
import { useCultivationStore } from '@/stores/cultivation'
import { useAdventureStore } from '@/stores/adventure'
import { useGameStore } from '@/stores/game'
import { useUiStore } from '@/stores/ui'
import { useEndgameStore } from '@/stores/endgame'
import { useApprenticeStore } from '@/stores/apprentice'
import { sanitizeAllStores } from '@/stores/sanitizeAll'
import { apprenticeReturnText } from '@/ui/apprenticeText'

/** 离线事件兜底池(世界标签不命中时用):只放无代价、可幂等自动结算的 general 事件 */
const DEFAULT_OFFLINE_EVENT_IDS = ['ev_spring', 'ev_herb_garden', 'ev_night_talk', 'ev_falling_star', 'ev_old_man']

/** 离线自动结算放行的事件效果;身份/永久构筑类(pet、gongfa、artifact、lifespan)不替玩家拍板 */
const OFFLINE_SAFE_EFFECTS = new Set(['stone', 'exp', 'material', 'equipment', 'pill', 'buff', 'nothing'])
function isOfflineSafeEvent(ev: EventDef): boolean {
  return ev.choices.every(c => c.outcomes.every(o => o.effects.every(e => OFFLINE_SAFE_EFFECTS.has(e.type))))
}

/**
 * 离线单胜材料期望,与在线 afterWin 同源(单源取 drop 常量):herb ×E[1..3]=2,ore ×E[1..2]=1.5,page ×1.5×倍率。
 * dust 为离线独有,在线无此入口。
 */
export function offlineMaterialGain(
  wins: number,
  doubleMult: number,
  rewardMult: number
): { herb: number; ore: number; page: number; dust: number } {
  return {
    herb: Math.round(wins * HERB_DROP_CHANCE * 2 * doubleMult),
    ore: Math.round(wins * ORE_DROP_CHANCE * 1.5 * doubleMult),
    page: Math.round(wins * PAGE_DROP_CHANCE * 1.5 * rewardMult * doubleMult),
    dust: Math.round(wins * OFFLINE_FLAT_DUST_PER_WIN * doubleMult)
  }
}

/**
 * 结算离线收益
 * @param nowMs 当前时间戳
 */
export function settleOffline(nowMs: number): OfflineSummary | null {
  const game = useGameStore()
  const player = usePlayerStore()
  const resources = useResourcesStore()
  const inventory = useInventoryStore()
  const dongfu = useDongfuStore()
  const cultivation = useCultivationStore()
  const adventure = useAdventureStore()
  const endgameStore = useEndgameStore()
  const ui = useUiStore()

  if (!game.started || player.dead) return null
  const dtSec = Math.max(0, (nowMs - game.lastActiveAt) / 1000)
  if (dtSec < 1) return null

  const capSec = Math.min(dtSec, dongfu.offlineCapHours * 3600)
  const effSec = capSec * OFFLINE_EFFICIENCY
  const notes: string[] = []
  const equipmentGained: OfflineSummary['equipment'] = []
  /** 离线化尘所得(自动回收、满包化尘、腾位旧件) */
  let recycledDust = 0
  let evicted = 0
  /*
   * 离线期间每次装备入账(历练掉落、镇压产出、际遇奖励)都记这本账;入包件带 uid,化尘的不带。
   * 腾位不能只看 bagged:被挤掉的旧件化出的尘与件数也要记。
   */
  const stopLedger = onAcquire((inst, res) => {
    equipmentGained.push({
      name: equipmentTemplate(inst.templateId)?.name ?? '未知',
      quality: inst.quality,
      recycled: !res.bagged,
      uid: res.bagged ? inst.uid : undefined
    })
    recycledDust += res.dust
    if (res.evicted) evicted += 1
  })

  // 须在一切产出之前剪掉已过期 buff,否则过期加成对整段离线生效;途中才过期的按整段生效(留档)
  const goneBuffNames = cultivation.buffs
    .filter(b => b.endsAt <= nowMs)
    .map(b => buffDef(b.defId)?.name)
    .filter((n): n is string => n !== undefined)
  cultivation.pruneBuffs(nowMs)
  if (goneBuffNames.length > 0) notes.push(`「${goneBuffNames.join('、')}」已到期`)

  // 收割离线完工的道童(与道童页同走 collectFinished);漏收则归来先转世时 resetForRebirth() 连资材清空
  const reapedApprentices = useApprenticeStore().collectFinished(nowMs, player.major)
  if (reapedApprentices.length > 0) notes.push(apprenticeReturnText(reapedApprentices, player.major))

  const expBefore = { ...player.exp }
  player.gainExp(mulN(gn(player.cultPerSec), effSec))

  const qiBefore = resources.qi
  resources.setQi(resources.qi + player.qiRegenPerSec * effSec, player.qiCapValue)

  const herbBefore = resources.herb
  const herbBeforeByGrade = { ...resources.herbByGrade }
  const oreBefore = resources.ore
  const wudaoBefore = resources.wudao
  dongfu.produce(effSec)

  // 藏经阁被动钻研:与在线同源
  studyTick(effSec)

  // 镇压收益按 capSec 结:豁免 0.9 离线效率,不豁免洞府离线上限
  // 妖气复聚按真实此刻判(两个时刻分开传);收益先结清再复聚,否则复聚在开头就松开、整段收益归零
  const suppressYield = settleSuppressedRegions(capSec, rng, nowMs)
  if (suppressYield && suppressYield.revived.length > 0) {
    // 妖气复聚须写进归来卷轴,不能只靠提示条
    const names = suppressYield.revived.map(id => regionDef(id)?.name ?? id)
    const head = names.slice(0, 3).join('、')
    const tail = names.length > 3 ? ` 等 ${names.length} 处` : ''
    notes.push(`妖气复聚:${head}${tail}的旧主归来 —— 再历一程即可复靖`)
  }
  /**
   * 镇压被妖气松开也要写进卷轴,而且它比「旧主归来」更常发生。
   *
   * 只镇压、从不靖平的地界(最常见的形态:靠胜场压制,不去打首领)满 72 小时后
   * 同样复聚 —— 而 `settleRegionRevivals` 从前只回报 `returned`,这一类于是
   * 只走一条 toast,离线归来时它早飘过去了。玩家回来只看见产出条不见了、
   * 按钮从「停取收益」变成「转为镇压收益」:收益为什么停了、还能不能接回来,
   * 卷轴上一个字都没有。这里补上,并顺手给出解法(资格仍在,一键接回)。
   */
  if (suppressYield && suppressYield.loosened.length > 0) {
    const names = suppressYield.loosened.map(id => regionDef(id)?.name ?? id)
    const head = names.slice(0, 3).join('、')
    const tail = names.length > 3 ? ` 等 ${names.length} 处` : ''
    notes.push(`妖气复聚:${head}${tail}的镇压松开,此地重新成为历练之地 —— 镇压资格仍在,一键即可接回收益`)
  }
  if (suppressYield && !isZero(suppressYield.stone)) {
    const extra = suppressYield.resources.map(r => `${r.name} +${r.amount}`).join(' · ')
    const dao = isZero(suppressYield.expGain) ? '' : ` · 道韵修为 +${formatGN(suppressYield.expGain)}`
    notes.push(`镇压诸域仍有余韵:灵石 +${formatGN(suppressYield.stone)}${extra ? ` · ${extra}` : ''}${dao}`)
  }

  // ---- 历练挂机 ----
  let battles = 0
  let wins = 0
  let events = 0
  // 计入会话的胜负,与在线 runBattle 同一本账(含首领战)
  // 败场也须记:提前收手的 3 战门槛按胜+负判
  let sessionWins = 0
  let sessionLosses = 0
  const stoneBefore = { ...resources.spiritStone }
  const session = adventure.session
  // 本段历练所得,折进会话总账(与实发同一份数,不另算)
  const trip = { stone: gnZero(), exp: gnZero(), items: 0 }
  if (session) {
    const region = regionDef(session.regionId)
    if (region) {
      const modeDef = EXPLORE_MODES[session.mode]
      // 与在线同源:灵兽性格修正危险,普通战与首领战共用
      const petDangerMult = personalityEffects(player.petId).dangerMult
      // 与在线同源:区域事件同时改危险(dangerMult)与加丰(rewardMult),两侧都须接
      const regEvent = currentRegionEvent(region.id)
      const regionEventDanger = regEvent ? (regionEventDef(regEvent.eventId)?.dangerMult ?? 1) : 1
      const regionEventReward = regEvent ? (regionEventDef(regEvent.eventId)?.rewardMult ?? 1) : 1
      const remainSec = Math.max(0, (session.endsAt - (nowMs - dtSec * 1000)) / 1000)
      const simSec = Math.min(capSec, remainSec)
      const mods = player.finalStats.mods
      // 遇敌间隔与在线同源(exploreBattleGapSec),不内联间隔公式
      const battleGapSec = exploreBattleGapSec(modOf(mods, 'explorationSpeed'))
      const encounters = Math.floor(simSec / battleGapSec)
      // 与在线同源:exploreEventChance(含星象之利)
      events = Math.round(encounters * exploreEventChance(region.id, mods))
      battles = Math.max(0, encounters - events)

      if (battles > 0) {
        // 破题与在线同源:祭着法宝(非仅持有)交手即 noteTaboo('artifact');幂等,整段记一次等价逐场记
        if (inventory.equippedArtifacts.length > 0) {
          const vowBefore = vowResult()
          noteTaboo('artifact')
          // 归来卷轴再说一声:破题 toast 在结算途中就飘过去了,玩家多半没看见
          if (vowBefore !== 'broken' && vowResult() === 'broken') {
            notes.push('【破题】离线这一程祭着法宝出手,「独行」之誓没能说到底')
          }
        }
        // 与在线同源:敌群取自本世路线节点
        const mobId = rng.pick([...placeContent(region.id).enemies])
        const mobDef = enemyDef(mobId)
        const dangerFactor = dangerFactorFor(modeDef.dangerMult, region.danger, petDangerMult, regionEventDanger)
        // 与在线同源:explorationRules(道途规则 × 本世逆旅契)
        const winRate = mobDef
          ? sampleWinRate(buildPlayerSnap(), makeEnemySnap(mobDef, region.tier, dangerFactor), rng, 3, explorationRules())
          : 0.3
        wins = Math.round(battles * winRate)
        sessionWins += wins
        sessionLosses += battles - wins

        // 与在线 afterWin 同源:乘区域加丰;福缘在线每战掷翻倍,离线按期望 ×(1+p) 计入
        const doubleMult = 1 + Math.min(1, Math.max(0, modOf(mods, 'doubleDropRate')))
        const stoneGain = stoneByTier(
          region.tier,
          10 * wins * modeDef.rewardMult * regionEventReward * (1 + modOf(mods, 'spiritStoneGain')) * doubleMult
        )
        resources.addStone(stoneGain)
        // 修为与在线 afterWin 同走 expFromSecs:秒数与层上限都随场数线性放大,N 场 = N 次单场
        const expGain = expFromSecs(
          player.expReq,
          BATTLE_EXP_SECS * wins * modeDef.rewardMult * regionEventReward * (1 + modOf(mods, 'expGain')) * doubleMult,
          player.cultPerSec,
          INSTANT_EXP_LAYER_CAP * wins
        )
        player.gainExp(expGain)
        trip.stone = add(trip.stone, stoneGain)
        trip.exp = add(trip.exp, expGain)
        const { herb: herbGain, ore: oreGain, page: pageGain, dust: dustGain } = offlineMaterialGain(
          wins,
          doubleMult,
          modeDef.rewardMult * regionEventReward
        )
        resources.addHerb(herbGradeOfMajor(region.minRealm), herbGain)
        resources.addSmall('ore', oreGain)
        harvestMaterials(region.tier, 'herb', herbGain)
        harvestMaterials(region.tier, 'ore', oreGain)
        resources.addSmall('page', pageGain)
        resources.addSmall('dust', dustGain)
        // 装备:最多生成 6 件,其余折尘;掉落数与在线 afterWin 同源(模式 × 加丰 × 福缘),每场概率同吃 EQUIP_DROP_CHANCE_CAP
        const equipChance = Math.min(
          EQUIP_DROP_CHANCE_CAP,
          EQUIP_DROP_CHANCE * modeDef.rewardMult * regionEventReward * (1 + modOf(mods, 'dropRate'))
        )
        const equipCount = Math.round(wins * equipChance * doubleMult)
        const realCount = Math.min(6, equipCount)
        for (let i = 0; i < realCount; i += 1) {
          // 灵兽性格同样管掉落,与在线 afterWin 同源
          const inst = generateEquipment(region.tier, rng, { luck: modOf(mods, 'luck') + personalityEffects(player.petId).dropLuck })
          // 入账、化尘、腾位由开头 onAcquire 那本账统一记
          acquireEquipment(inst, { quiet: true })
        }
        trip.items += realCount
        if (equipCount > realCount) {
          // 溢出件数本应是「这批新掉落被分解」的尘 —— 与在线 afterWin 同一把尺:
          // 在线每件掉落经 acquireInto→salvageOf 化尘(底材,按品质阶),离线按同层级的
          // 平均分解尘 avgDustPerDrop(tier) 折算(单源取 economySim 的采样口径)。
          // 旧固定 4 尘只在中阶(约 tier 12)碰巧对得上,低阶多发、高阶却少给近一个数量级,
          // 与「离线≈在线 N 场」不变量相背。
          const overflowDust = Math.round((equipCount - realCount) * avgDustPerDrop(region.tier))
          resources.addSmall('dust', overflowDust)
          notes.push(`另有 ${equipCount - realCount} 件寻常之物,已折作器灵尘`)
        }
        // 丹药 —— 补上离线普通战漏掉的掉落通道,与在线 afterWin 同源:
        // 在线每战按 PILL_DROP_CHANCE × 模式 × 区域事件加丰掷一枚(福缘翻倍不作用于丹药,
        // 在线也是掷在 doubled 循环之外);离线首领战后文直接复用 afterWin 因而会掉,
        // 普通战此前却只算石头/修为/材料/装备、独漏丹药,与「离线≈在线 N 场」守恒不符。
        // 单场概率夹在线那道封顶,离线按期望值结算:胜场 × 单场概率即丹药枚数。
        const pillChance = capChance(PILL_DROP_CHANCE * modeDef.rewardMult * regionEventReward)
        const pillCount = Math.round(wins * pillChance)
        for (let i = 0; i < pillCount; i += 1) {
          const pillId = randomDropPill(player.major)
          if (!pillId) break
          inventory.addPill(pillId, 1)
          collect('pill', pillId)
          trip.items += 1
        }
        if (pillCount > 0) {
          notes.push(`途中拾得丹药 ${pillCount} 枚`)
        }
        /**
         * 法宝 —— 与在线 afterWin 同源的最后一条掉落通道。
         *
         * 在线每胜一场按 `ARTIFACT_DROP_CHANCE ×(1+luck)` 掷一次(概率先归到 [0,1]);
         * 离线此前只补了丹药与装备,法宝这一条整段缺席 —— 挂一夜的期望法宝数恒为 0,
         * 而同样时长在线打下来是 `wins × 1.5% × (1+luck)`。
         *
         * 按期望折算成「这一趟出几件」:与丹药同一纪律,福缘翻倍不作用于法宝
         * (在线也掷在 doubled 循环之外);概率同样先夹在线那道封顶。
         * 只入囊、不自动祭上 —— 祭炼由玩家亲手决定(见本世逆命契的同一原则)。
         */
        const artifactChance = capChance(ARTIFACT_DROP_CHANCE * (1 + modOf(mods, 'luck') + personalityEffects(player.petId).dropLuck))
        const artifactCount = Math.round(wins * artifactChance)
        /** 按 defId 聚合:同件只报一行,重复件折悟道点并入(见 offlineArtifactNote) */
        const artifactTally = new Map<string, { name: string; count: number; wudao: number }>()
        for (let i = 0; i < artifactCount; i += 1) {
          const artId = randomDropArtifact(region.tier)
          if (!artId) break
          const gain = acquireArtifactGain(artId, true, false)
          if (!gain) break
          const tallied = artifactTally.get(gain.defId)
          if (tallied) {
            tallied.count += 1
            tallied.wudao += gain.wudao
          } else {
            artifactTally.set(gain.defId, { name: gain.name, count: 1, wudao: gain.wudao })
          }
          trip.items += 1
        }
        if (artifactTally.size > 0) notes.push(offlineArtifactNote([...artifactTally.values()]))
        if (wins < battles) {
          notes.push(`有 ${battles - wins} 战失利,幸而全身而退`)
        }
        /**
         * 连胜与在线同源:在线逐场 recordWin/recordLoss,跨过 3/5/10 档即发赏格、
         * 败一场归零。离线整段结算从前完全不碰 `winStreak` —— 挂一夜连胜数字纹丝不动,
         * 赏格也从不发放,战斗页那句「再连胜 N 场可得…」在离线时成了空话。
         * 这里按「胜场接上、败场收尾」的同一顺序整批结算。
         */
        for (const reward of recordWinStreakBatch(wins, battles - wins)) {
          notes.push(`途中${streakRewardText(reward.streak, reward.stone, reward.wudao)}`)
        }
        /**
         * 道侣机会点与在线同源:在线每个历练情境走一次 `offerBondEvent`
         * (首胜一次、败北一次;败一场这趟历练就中止),由它把机会点 +1。
         * 离线整段从前一个都不攒 —— 「走得多才有机会」在挂机时成了空话。
         *
         * 这里只补**记账**:不抽事件、不碰缘分/信任/契合 —— 关系怎么走
         * 必须由玩家亲手选。次数按在线情境数封顶(胜一次 + 败一次最多两回),
         * 不按胜场数放大,免得挂一夜攒出几十个机会点。
         */
        gainBondOpportunities((wins > 0 ? 1 : 0) + (battles > wins ? 1 : 0))
        track('kills', wins)
        track('battles', battles)
        // 图鉴与区域战绩与在线同口径整段入账:净胜批量入账(见 applyRegionWinBatch),照面胜 +1 / 负 ×ENEMY_LORE_LOSS_WEIGHT
        if (mobId) noteEnemyMany(mobId, wins, battles - wins)
        // 宿敌账与在线 recordLoss 同源,败场整批入账
        if (mobId && mobDef && battles > wins) {
          const { list, becameNemesis } = recordLossBatch(
            player.nemeses,
            mobDef.id,
            mobDef.name,
            region.id,
            nowMs,
            battles - wins
          )
          player.setNemeses(list)
          if (becameNemesis) {
            notes.push(`【宿敌】你已在${mobDef.name}手下败北${NEMESIS_THRESHOLD}次——此敌已成你的宿敌!`)
          }
        }
        /**
         * 雪耻与在线同源:在线打赢一位仍在账上的宿敌,当场清账并播报。
         * 离线整段结算里这一段净胜为正,就等于在它手下赢过。
         * 从前只补败北不补雪耻,挂机把它打回去几十次,征战录仍写着「尚为宿敌」。
         */
        if (mobDef && wins > 0 && isNemesis(player.nemeses, mobDef.id)) {
          player.setNemeses(markAvenged(player.nemeses, mobDef.id, nowMs))
          notes.push(`【雪耻】宿敌${mobDef.name}已被斩于剑下!`)
        }
        if (wins > 0 && mobDef) {
          // 抽一场代表战取回合数/受伤比(与在线 checkSuppression 吃同一份数据)
          const sampleFight = resolveCombat(
            buildPlayerSnap(),
            makeEnemySnap(mobDef, region.tier, dangerFactor),
            rng,
            explorationRules()
          )
          player.applyRegionWinBatch(
            region.id,
            wins,
            sampleFight.rounds,
            Math.max(0, 1 - sampleFight.playerHpPct)
          )
          if (checkSuppression(player, region.id) && !player.suppressQualified.includes(region.id)) {
            player.markSuppressQualified(region.id)
            player.suppressRegion(region.id)
            // 与在线达成回执同一份产出账(suppressRateLine 单源),普通战/首领战两处同口径
            notes.push(
              `你已彻底镇压${region.name},此后将自动产出:${suppressRateLine(region.id, regionRecallFor(region.id).prosperity)}`
            )
          }
        }
      }
      // 事件按默认选项自动结算
      const evCap = Math.min(events, 40)
      // 与在线同源:事件取自本世路线节点(regionEventPoolFor);不走 pickEventFor 的机缘/奇缘分支,离线不替玩家拍板
      const worldEventTags = [...placeContent(region.id).eventTags]
      let offlineEventPool = regionEventPoolFor({ ...region, eventTags: worldEventTags })
        .filter(isOfflineSafeEvent)
        .map(ev => ev.id)
      if (offlineEventPool.length === 0) offlineEventPool = DEFAULT_OFFLINE_EVENT_IDS
      for (let i = 0; i < evCap; i += 1) {
        if (adventure.pendingEventId) {
          autoResolveEvent(adventure.pendingEventId, region.tier)
          adventure.setPendingEvent(null, nowMs)
        } else {
          autoResolveEvent(rng.pick(offlineEventPool), region.tier)
        }
      }
      // summary 与 session 只报实际结算的事件数
      events = evCap
      // 离线自动挑战区域首领(收益折损,胜则连锁解锁)
      // 已清按本世路线判(regionBossCleared,与在线同源);门槛数整趟会话胜场(含本段);本段须真交过手
      const bossDue = winsUntilRegionBoss(session.wins + wins, regionBossCleared(region.id)) === 0
      if (bossDue && battles > 0) {
        const bossDef = enemyDef(placeContent(region.id).boss)
        if (bossDef) {
          const bossDanger = dangerFactorFor(modeDef.dangerMult, region.danger, petDangerMult, regionEventDanger)
          const bossResult = resolveCombat(buildPlayerSnap(), makeEnemySnap(bossDef, region.tier, bossDanger), rng, explorationRules(), false)
          noteEnemy(bossDef.id, bossResult.win)
          // 首领战计一场(与在线 runBattle 同一本账,不论胜败);须在奖励结算之后,不重复放大奖励
          track('battles')
          battles += 1
          if (bossResult.win) {
            // 与在线首领同乘 mode×regReward,另叠收益折损
            // 第四参 false:玩家不在场,不自动祭上掉落的法宝(同 autoResolveEvent)
            const drops = afterWin(region, modeDef.rewardMult * OFFLINE_BOSS_REWARD_MULT * regionEventReward, true, false)
            trip.stone = add(trip.stone, drops.stone)
            trip.exp = add(trip.exp, drops.exp)
            trip.items += drops.items
            track('kills')
            track('bossKills')
            wins += 1
            sessionWins += 1
            // 首领胜也是一场胜:连胜照推,跨过赏格档照发(与在线 runBattle 同一本账)
            for (const reward of recordWinStreakBatch(1, 0)) {
              notes.push(`斩将之后${streakRewardText(reward.streak, reward.stone, reward.wudao)}`)
            }
            player.updateRegionStats(region.id, true, bossResult.rounds, Math.max(0, 1 - bossResult.playerHpPct))
            player.recordRegionWin(region.id)
            if (checkSuppression(player, region.id) && !player.suppressQualified.includes(region.id)) {
              player.markSuppressQualified(region.id)
              player.suppressRegion(region.id)
              // 与在线达成回执同一份产出账(suppressRateLine 单源),普通战/首领战两处同口径
              notes.push(
                `你已彻底镇压${region.name},此后将自动产出:${suppressRateLine(region.id, regionRecallFor(region.id).prosperity)}`
              )
            }
            clearRegionAndUnlockNext(region.id)
            notes.push(offlineBossNoteText(bossDef.name))
            /**
             * 首领战也是「打赢一场」:在线 runBattle 的取胜分支里,不论对手是不是首领,
             * 只要账上仍记着这个宿敌就当场 markAvenged。离线普通战已补(见上),
             * 首领这一场却漏着 —— 整趟只赢在首领头上时,征战录仍写「尚为宿敌」。
             */
            if (isNemesis(player.nemeses, bossDef.id)) {
              player.setNemeses(markAvenged(player.nemeses, bossDef.id, nowMs))
              notes.push(`【雪耻】宿敌${bossDef.name}已被斩于剑下!`)
            }
          } else {
            sessionLosses += 1
            // 首领败连胜归零(与在线同源)
            recordWinStreakBatch(0, 1)
            // 首领败北记宿敌账(与在线同源)
            const { list, becameNemesis } = recordLossBatch(
              player.nemeses,
              bossDef.id,
              bossDef.name,
              region.id,
              nowMs,
              1
            )
            player.setNemeses(list)
            if (becameNemesis) {
              notes.push(`【宿敌】你已在${bossDef.name}手下败北${NEMESIS_THRESHOLD}次——此敌已成你的宿敌!`)
            }
            notes.push(`曾遭遇区域之主【${bossDef.name}】,惜败而退,需再蓄力`)
          }
        }
      }
      if (simSec >= remainSec) {
        adventure.setSession(null)
        track('explores')
        notes.push(`${region.name}之行圆满结束`)
      } else {
        adventure.setSession({
          ...session,
          wins: session.wins + sessionWins,
          losses: session.losses + sessionLosses,
          events: session.events + events,
          stoneGain: add(session.stoneGain, trip.stone),
          expGain: add(session.expGain, trip.exp),
          itemGain: session.itemGain + trip.items,
          // 与在线 nextBattleTime 同源
          nextBattleAt: nowMs + battleGapSec * 1000
        })
      }
    }
  }

  // 寿元流逝不受离线上限约束
  const ageBefore = player.age
  player.addAge((dtSec / 3600) * AGE_YEARS_PER_HOUR)

  cultivation.pruneBuffs(nowMs)

  stopLedger()
  const summary: OfflineSummary = {
    seconds: dtSec,
    cappedSeconds: capSec,
    capped: dtSec > capSec + 1,
    exp: sub(player.exp, expBefore),
    stone: sub(resources.spiritStone, stoneBefore),
    qi: Math.round(resources.qi - qiBefore),
    herb: resources.herb - herbBefore,
    // 逐品净增(仅列 >0):灵田可产高一档,不能按单品报
    herbByGrade: HERB_GRADES.map(g => ({
      grade: g,
      amount: resources.herbOf(g) - (herbBeforeByGrade[g] ?? 0)
    })).filter(e => e.amount > 0),
    ore: resources.ore - oreBefore,
    wudao: resources.wudao - wudaoBefore,
    ageYears: Math.floor(player.age - ageBefore),
    battles,
    wins,
    events,
    equipment: equipmentGained,
    recycledDust,
    evicted,
    notes
  }
  if (player.expFull && !player.atMaxRealm) notes.push(breakthroughReadyNote(breakthroughInfo().needTribulation))
  if (summary.ageYears > 0) notes.push(offlineAgeNote(summary.ageYears))

  /**
   * 在途的一次性内容**原样冻结** —— 这一点玩家看不见,得说一句。
   *
   * 秘境与远征都不会在缺席期间偷偷推进(见 offlineScope.spec:离线只动 exp/age/bond),
   * 但玩家回来只看到一屏资源,很容易以为「我不在的时候那趟远征是不是黄了」。
   * 故凡有在途内容,归来卷轴上就明说一句:它还等着你。
   */
  const inFlight = player as unknown as { secretRealm?: unknown }
  if (inFlight.secretRealm) notes.push('秘境之行原样留着 —— 层数、气血与规则都未变,回来接着走')
  if (endgameStore.worldRun) notes.push('那趟远征仍在途 —— 层数与战绩原样留着,回来接着走')
  /**
   * 被离线上限截断的历练会话也要说一句。
   *
   * 8h / 16h 两档长线行程配低阶洞府时,离线只结到洞府上限(0 级 8h),
   * 会话不结束、`nextBattleAt` 照旧排在未来 —— 玩家回来看到历练还在跑,
   * 却不知道为什么只结算了一半。秘境与远征都有「仍在途」那句,历练被 cap
   * 截断时偏偏没有,于是这半程成了一个要自己去翻会话面板才明白的哑谜。
   *
   * 判据看**会话自己**还剩多久,不拿 `dtSec > capSec` 当代理:离线时长正好等于
   * 上限(离线 8h、洞府 0 级 cap 8h、行程 16h)时那个代理判假,而这正是「结了一半」
   * 最不该沉默的一格 —— 实测归来卷轴 13 行,没有一句提到这程还在走。
   */
  if (adventure.session) {
    const left = Math.max(0, (adventure.session.endsAt - nowMs) / 1000)
    if (left > 0) {
      notes.push(`这一程还没走完 —— 离线只结到 ${formatDuration(capSec)}(洞府上限),尚余 ${formatDuration(left)}`)
    }
  }

  if (dtSec >= OFFLINE_MODAL_MIN_SECONDS) {
    track('offlineClaims')
    ui.offlineSummary = summary
  }
  return summary
}

/** 读档兜底:修平全部持久化分片(PERSISTED_STORES,见 utils/storage.ts)的形状;spec 钉:storeResilience.spec */
export function sanitizeOfflineInputs(): void {
  sanitizeAllStores()
}
