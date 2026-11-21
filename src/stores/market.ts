/**
 * 坊市状态 —— 货架与刷新时刻(持久化,须带 sanitize;见 storeResilience.spec)
 * 装备实例不落库存:每格只存 (tier, 品质下限),预览/购买时由 marketService 按 (stockedAt, idx) 确定性再生,预览与购买同源同一物
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { persistConfig } from '@/utils/storage'
import { truncateCodePoints } from '@/utils/saveShape'
import { NAME_MAX_LENGTH } from '@/data/constants'
import { usePlayerStore } from '@/stores/player'
import { useResourcesStore } from '@/stores/resources'
import { useInventoryStore } from '@/stores/inventory'
import { useLoreStore } from '@/stores/lore'
import { collect } from '@/core/progress'
import { reportAction, resyncFromCloud, runActionAwait } from '@/core/remoteAction'
import { pillDef } from '@/data/pills'
import { MAX_EQUIP_TIER, equipmentTemplate } from '@/data/equipment'
import { qualityDef } from '@/data/qualities'
import {
  MARKET_REFRESH_SECONDS,
  MARKET_CONSIGN_SLOTS,
  MARKET_CONSIGN_SECONDS,
  MARKET_MAT_COUNT,
  MARKET_SLOTS,
  type ConsignPost,
  type MarketSlot
} from '@/data/market'
import {
  consignPrice,
  generateMarketStock,
  herbSellBatch,
  marketPayPrice,
  materialSellPrice,
  pillSellPrice
} from '@/core/marketService'
import { mintDrops } from '@/core/lootClaim'
import { useAuthStore } from '@/stores/auth'
import { cloudApi } from '@/services/cloud'
import type { EquipmentInstance } from '@/types'
import type { HerbGrade } from '@/data/herbGrades'
import { herbGradeOfMajor, isHerbGrade } from '@/data/herbGrades'
import { asArray, asPrice, asTimestamp } from '@/utils/saveShape'
import { gnZero, mulN } from '@/utils/gnum'
import type { GNum } from '@/types'

/** `expired` = 点下去的这一瞬正好跨过换货窗口:货架已整架换新,`idx` 指的是另一格货;宁可不成交 */
export type MarketBuyResult = 'ok' | 'sold' | 'poor' | 'bagfull' | 'missing' | 'expired' | 'busy' | 'netfail'

export const useMarketStore = defineStore(
  'market',
  () => {
    const stock = ref<MarketSlot[]>([])
    const stockedAt = ref(0)
    const consign = ref<ConsignPost[]>([])
    /**
     * 购买在途闸。买装备要跨两次网络(签发 + 记账),期间 slot.sold 还没置位,
     * 按钮的 disabled 也还是 false —— 连点会两件都签发、两笔都记账、两份灵石都扣。
     */
    let buying = false

    /**
     * 存档修复:货架逐格修形,烂格与格号(idx)缺失的格子整格丢弃;时刻夹回非负。
     * 重复号:装备只留先出现的那格(改号会让标价与实得品质分叉);丹/料重排到最小空闲号保货。
     * 先完整校验、再按序认号:坏格不会抢走后面好货的号。
     */
    function sanitize(): void {
      /*
       * 货架起钟**不在 sanitize 里改** —— 它是装备实例的确定性种子
       * (`marketEquipInstance` 用 `(stockedAt, idx)` 再生),改了种子,
       * 同一格会变成另一件:预览看到 A,买到的却是 B(审查意见指出的)。
       * 归零也不行:归零等于「早就过期」,已存档的货架当场作废,买它会得 `expired`。
       *
       * 未来起钟的死锁改在 `sync` 里解(见那里的注释):那里既有「现在」,
       * 也能在不改种子的前提下把货架当成当刻刚上架。
       */
      stockedAt.value = Math.max(0, asTimestamp(stockedAt.value, 0))
      // idxClean:该行的 idx 原本就是合法非负整数(没被坏档修正过)
      const validated: (MarketSlot & { idxClean: boolean })[] = []
      const usedIdx = new Set<number>()
      for (const raw of asArray<unknown>(stock.value)) {
        if (!raw || typeof raw !== 'object' || !('kind' in raw)) continue
        const kind = raw.kind
        if (kind !== 'pill' && kind !== 'material' && kind !== 'equipment') continue
        const sold = 'sold' in raw && raw.sold === true
        const rawIdx = 'idx' in raw ? raw.idx : undefined
        if (typeof rawIdx !== 'number' || !Number.isFinite(rawIdx)) continue
        const idx = Math.max(0, Math.floor(rawIdx))

        if (kind === 'pill') {
          if (!('pillId' in raw) || typeof raw.pillId !== 'string' || !pillDef(raw.pillId)) continue
          const price = asPrice('price' in raw ? raw.price : undefined)
          if (price.m <= 0) continue
          validated.push({
            kind,
            idx,
            idxClean: typeof rawIdx === 'number' && Number.isFinite(rawIdx) && rawIdx >= 0,
            pillId: raw.pillId,
            count: 1,
            price,
            sold
          })
        } else if (kind === 'material') {
          const matId = 'matId' in raw ? raw.matId : undefined
          if (matId !== 'herb' && matId !== 'ore') continue
          const price = asPrice('price' in raw ? raw.price : undefined)
          if (price.m <= 0) continue
          // 上货时钉死的灵草品阶要跨读档保留:否则读档掉回无级,「标价/入账/显示同源」约定失效
          const g = 'grade' in raw ? raw.grade : undefined
          validated.push({
            kind,
            idx,
            idxClean: typeof rawIdx === 'number' && Number.isFinite(rawIdx) && rawIdx >= 0,
            matId,
            grade: isHerbGrade(g) ? g : undefined,
            count: MARKET_MAT_COUNT,
            price,
            sold
          })
        } else {
          const price = asPrice('price' in raw ? raw.price : undefined)
          if (price.m <= 0) continue
          validated.push({
            kind,
            idx,
            idxClean: typeof rawIdx === 'number' && Number.isFinite(rawIdx) && rawIdx >= 0,
            tier: Math.min(MAX_EQUIP_TIER, Math.max(1, Math.floor(Number('tier' in raw ? raw.tier : 1) || 1))),
            minQualityRank: Math.min(
              qualityDef('divine').rank,
              Math.max(0, Math.floor(Number('minQualityRank' in raw ? raw.minQualityRank : 0) || 0))
            ),
            price,
            sold
          })
        }
      }
      // 两阶段认号:先让装备占住原号,再给丹/料补空位;边扫边补时重复丹格会占掉后面装备的原号
      /*
       * 同号冲突时,原号本来就合法的那行优先 —— 坏档里 idx 写成 -3 的行会被夹到 0,
       * 若它排在前面就会把真正的 0 号装备挤掉,玩家看到装备凭空少一件。
       */
      const equipOrder = validated
        .filter(v => v.kind === 'equipment')
        .sort((a, b) => Number(b.idxClean) - Number(a.idxClean))
      const equipmentIdx = new Set<number>()
      for (const slot of equipOrder) {
        if (equipmentIdx.has(slot.idx)) continue
        equipmentIdx.add(slot.idx)
      }
      for (const idx of equipmentIdx) usedIdx.add(idx)
      const clean: MarketSlot[] = []
      const placedEquipment = new Set<number>()
      const orderedValidated = [
        ...validated.filter(v => v.kind === 'equipment').sort((a, b) => Number(b.idxClean) - Number(a.idxClean)),
        ...validated.filter(v => v.kind !== 'equipment')
      ]
      for (const slot of orderedValidated) {
        if (slot.kind === 'equipment') {
          if (placedEquipment.has(slot.idx)) continue
          placedEquipment.add(slot.idx)
          clean.push(slot)
          continue
        }
        let idx = slot.idx
        while (usedIdx.has(idx)) idx += 1
        usedIdx.add(idx)
        clean.push(idx === slot.idx ? slot : { ...slot, idx })
      }
      /*
       * 货架条数封顶。
       *
       * `MARKET_SLOTS`(6)是 `marketService` 上货时的格数,而 `clean` 按存档里的条数
       * 原样收 —— 坏档塞 500 条合法货品会被全吃下,而 `MarketShelfSection` 的
       * `cards` 是对全量 `market.stock` 直接 `map`,页面就渲 500 张卡。
       *
       * 上界取 `MARKET_SLOTS`:货架本来只有 6 格,多出来的必然是坏档。按原顺序保留前
       * `MARKET_SLOTS` 条,与「idx 从小到大」的摆放顺序一致。
       */
      stock.value = clean.slice(0, MARKET_SLOTS)

      const posts: ConsignPost[] = []
      for (const raw of asArray<unknown>(consign.value)) {
        if (!raw || typeof raw !== 'object' || !('finishAt' in raw)) continue
        /*
         * 坏档里的负 finishAt 整条丢弃,不夹成 0。
         *
         * 原先是 `Math.max(0, Math.floor(raw.finishAt))`,紧跟着 `if (finishAt < 0) continue`
         * ——夹到 0 之后那个 continue 永远不会触发。而 finishAt=0 意味着「已在过去到期」,
         * 玩家一进游戏就被迫结算一笔本不该有的寄卖,钱和货凭空产生。
         */
        const rawFinishAt = Math.floor(Number(raw.finishAt))
        if (!Number.isFinite(rawFinishAt) || rawFinishAt <= 0) continue
        const finishAt = rawFinishAt
        const rawTier = Number('tier' in raw ? raw.tier : 1)
        const rawQualityRank = Number('qualityRank' in raw ? raw.qualityRank : 0)
        const tier = Math.min(MAX_EQUIP_TIER, Math.max(1, Math.floor(rawTier || 1)))
        const qualityRank = Math.min(
          qualityDef('divine').rank,
          Math.max(0, Math.floor(rawQualityRank || 0))
        )
        const price = asPrice('price' in raw ? raw.price : undefined)
        const badTier = !Number.isFinite(rawTier) || rawTier < 1 || rawTier > MAX_EQUIP_TIER
        const badQualityRank =
          !Number.isFinite(rawQualityRank) || rawQualityRank < 0 || rawQualityRank > qualityDef('divine').rank
        posts.push({
          slot: Math.max(0, Math.floor(Number('slot' in raw ? raw.slot : posts.length) || 0)),
          tier,
          qualityRank,
          // 寄卖价是交货时定下的契约;只有价格或层级/品质坏掉时才按同一公式重建
          price: price.m > 0 && !badTier && !badQualityRank ? price : consignPrice(tier, qualityRank),
          finishAt,
          /*
           * 寄卖品名要截 —— 它渲染在寄卖格那一行(`{{ consignBySlot[s]!.name }}`)。
           * 写入路径取的是 `equipmentTemplate(...).name`(数据表里最长四五个字),
           * 坏档塞十万字符时那一行虽有 `truncate` 兜住视觉,文本节点与存档仍照大不误。
           * 取 `NAME_MAX_LENGTH * 2`(16 码点)已极宽,与其余「物名」字段同一把尺。
           */
          name: 'name' in raw && typeof raw.name === 'string' ? truncateCodePoints(raw.name, NAME_MAX_LENGTH * 2) : ''
        })
      }
      // 寄卖格号重排成唯一的 0..n-1,不丢任何一条:界面按格号铺格子,
      // 同号时只看见一件,到点却两笔都入账
      consign.value = posts
        .sort((a, b) => a.finishAt - b.finishAt || a.slot - b.slot)
        .map((p, i) => ({ ...p, slot: i }))
    }

    /** 货架空、或已过刷新窗口则重上一架 */
    function sync(now: number): void {
      /*
       * 起钟落在未来:判据要能解死锁,但不能动种子。
       *
       * 货架上的装备由 `(stockedAt, idx)` 确定性再生 —— 改 `stockedAt` 会让
       * 同一格变成另一件(预览 A、买到 B)。所以这里**不写 stockedAt**,
       * 只把「未来起钟」按「此刻刚上架」来判:窗口从此刻起算。
       * 起钟本身保持原值,种子不动,玩家手上的格子还是那一格。
       */
      const clockAt = stockedAt.value > now ? now : stockedAt.value
      if (stock.value.length > 0 && now < clockAt + MARKET_REFRESH_SECONDS * 1000) return
      const player = usePlayerStore()
      const gen = generateMarketStock(player.major, now)
      stock.value = gen.goods
      stockedAt.value = gen.stockedAt
    }

    /**
     * 按指定起钟重上一架货(1.79.4,服务端买入用)。
     *
     * 云档的 market 分片只在买入/首传时落库,心跳不推进它 —— 起钟会停在首传那一刻。
     * 玩家本地跨过刷新窗口后 sync 换新架,报上来的 at 与云档起钟对不上;若服务端拿
     * 云档起钟硬校验,就会判「货架已换新」→ 客户端 resync → 定时器再 sync → 买一次刷一次。
     * 货架内容由 (major, at) 确定性再生,at 只是「买哪一批货」的种子(价格仍由服务端复算),
     * 所以服务端采信 at、先按它重上同一架货再成交,预览与实得就同源了。
     */
    function restockAt(at: number): void {
      const gen = generateMarketStock(usePlayerStore().major, at)
      stock.value = gen.goods
      stockedAt.value = gen.stockedAt
    }

    /**
     * 成交记账漏斗(1.58.1):登录玩家下单前先让服务端按货架复算价并记一笔账。
     * 扣款写在客户端,不记账就等于白拿;记不上就不成交(与掉落签发「宁可不掉」同一口径)。
     * 未登录的单机玩家直接放行 —— 他们没有云档,服务端也无从记账。
     */
    async function quotePurchase(stockedAt: number, idx: number): Promise<boolean> {
      const auth = useAuthStore()
      if (!auth.loggedIn) return true
      try {
        const res = await cloudApi.marketBuy({ stockedAt, idx })
        return res.ok
      } catch {
        return false
      }
    }

    /**
     * 买下第 idx 格。
     *
     * 登录态整笔交给服务端(1.79.0):扣灵石、入丹/草/铁、签发装备都在云档上做,
     * 结果码放在 payload 里回来。此前是本地扣钱入货 + 服务端只记购买台账 ——
     * 抛弃存档之后,本地那份入货传不上去,钱却真扣了,买完即蒸发。
     *
     * 1.79.8:登录态开 strict —— 服务端 5xx/断网时**不再退回本地买入**。本地跑成的
     * 这一笔传不回云档(上传不带进度),玩家刷新即蒸发,货架又回到「可买」,
     * 等于同一格反复成交;服务端 500 一多就成了「买了刷新又能买」的表象根源。
     * 未登录 / 断网时退回本地实现(单机与测试走这条),行为与从前一致。
     */
    async function buy(idx: number): Promise<MarketBuyResult> {
      if (buying) return 'busy'
      buying = true
      try {
        const r = await runActionAwait<MarketBuyResult>(
          'market_buy',
          { at: stockedAt.value, index: idx },
          () => buyInner(idx),
          { strict: true }
        )
        /*
         * 1.79.5:服务端说买成了,本地却没收到 sold 补丁时不能装作没事 ——
         * 那就去拉一次整档重对齐,免得刷新后又看到「买下」,同一格被反复成交。
         */
        if (r.ok && r.value === 'ok' && stock.value.find(s => s.idx === idx)?.sold !== true) {
          void resyncFromCloud()
        }
        if (!r.ok) {
          // 服务端明确拒绝「货架已换新」照旧回 expired;其余(429/5xx/断网)如实报网络不畅
          return r.reason === '货架已换新' ? 'expired' : 'netfail'
        }
        return r.value ?? 'expired'
      } finally {
        buying = false
      }
    }

    async function buyInner(idx: number): Promise<MarketBuyResult> {
      const now = Date.now()
      const before = stock.value
      sync(now)
      // 换货了
      if (before.length > 0 && stock.value !== before) return 'expired'
      const slot = stock.value.find(s => s.idx === idx)
      if (!slot) return 'missing'
      if (slot.sold) return 'sold'
      const inventory = useInventoryStore()
      if (slot.kind === 'equipment' && inventory.bagFull) return 'bagfull'
      const resources = useResourcesStore()
      // VIP 有效期内九折:价签、缺口判据与扣款同读 marketPayPrice
      const pay = marketPayPrice(slot.price)
      // 先验灵石再让服务端记账:记账没有撤销接口,钱不够却记了账 = 上传时白扣一笔(1.63.0)
      if (!resources.hasStone(pay)) return 'poor'
      // 装备由签发侧按同一把货架锚再生:预览与购得同一物,uid 换成服务端签发并入台账。
      // 签发放在记账之前:签发失败(网络/服务端)时不记账也不扣钱;记账失败至多丢这件签发物,
      // 反过来「先记账再签发」失败会让玩家白扣灵石且无货可拿
      let inst: EquipmentInstance | undefined
      if (slot.kind === 'equipment') {
        ;[inst] = await mintDrops([{ src: 'market', tier: slot.tier, stockedAt: stockedAt.value, idx }])
        if (!inst) return 'expired'
      }
      // 登录玩家先让服务端记这笔账(它按同一把货架锚复算价格);记不上就不成交
      if (!(await quotePurchase(stockedAt.value, idx))) return 'expired'
      if (!resources.spendStone(pay)) return 'poor'
      if (slot.kind === 'pill') {
        inventory.addPill(slot.pillId, slot.count)
      } else if (slot.kind === 'material') {
        // 灵草按上货那一刻的品阶入账(与标价同源);旧档无 grade 按当下品兜底
        if (slot.matId === 'herb') {
          resources.addHerb(slot.grade ?? herbGradeOfMajor(usePlayerStore().major), slot.count)
        } else {
          resources.addSmall('ore', slot.count)
        }
      } else {
        inventory.addEquipment(inst!)
        // 买来的也计入见闻与收藏,见闻深度与掉落同口径;否则图鉴收录了、收藏页却缺这一件
        const q = qualityDef(inst!.quality)
        useLoreStore().noteEquipSeen(inst!.templateId, q.rank, inst!.tier)
        collect('equip', inst!.templateId)
      }
      slot.sold = true
      return 'ok'
    }

    /** 寄卖一件背包装备;离包即定,一到时辰自售入账,不可撤回 */
    function consignEquip(uid: string, now: number): 'ok' | 'full' | 'missing' {
      if (consign.value.length >= MARKET_CONSIGN_SLOTS) return 'full'
      const inventory = useInventoryStore()
      const eq = inventory.bagItems.find(it => it.uid === uid)
      if (!eq) return 'missing'
      const name = equipmentTemplate(eq.templateId)?.name ?? '一件兵刃'
      const slot = consign.value.reduce((max, p) => Math.max(max, p.slot + 1), 0)
      consign.value.push({
        slot: Math.min(slot, MARKET_CONSIGN_SLOTS - 1),
        tier: eq.tier,
        qualityRank: qualityDef(eq.quality).rank,
        price: consignPrice(eq.tier, qualityDef(eq.quality).rank),
        finishAt: now + MARKET_CONSIGN_SECONDS * 1000,
        name
      })
      inventory.removeEquipment(uid)
      return 'ok'
    }

    /** 收割已售出的寄卖:入账灵石,清掉到期的格子,回售出名 */
    function collectConsign(now: number): string[] {
      const credits: string[] = []
      let keep = consign.value.filter(p => p.finishAt > now)
      const resources = useResourcesStore()
      // 经济 op(1.77.0):每格到期寄卖上报服务端,按 tier+品质复算价记进项账;
      // 索引取收割前的档内序号,服务端从云档同序数组校验
      const finished = consign.value.filter(p => p.finishAt <= now)
      for (const p of finished) {
        void cloudApi
          .economyOp('market_sell_consign', {
            consignIdx: consign.value.indexOf(p)
          })
          .catch(() => {})
        resources.addStone(p.price)
        if (p.name) credits.push(p.name)
      }
      // 余下格子的 slot 规整回 0..n-1
      keep = keep
        .sort((a, b) => a.slot - b.slot)
        .map((p, i) => ({ ...p, slot: i }))
      consign.value = keep
      return credits
    }

    /*
     * 坊市卖出(1.79.2):曾经走 economyOp —— 那条路只在 stone_ledger 记一笔进项,
     * 扣货与入账都留在本地。1.78.0 之后云档不再吃整档上传,服务端那份 resources
     * 永远不知道货已卖、钱已入,心跳回补丁时本地这一笔就被打回 —— 玩家看到的就是
     * 「点了售出、货也没了、钱又没了」。改走 reportAction('sell_*'):服务端在云档上
     * 跑同一份 sellXxx,键级 diff 回传后货与钱一起落库(与已修好的 buy 同一条链)。
     * economy_claims / stone_ledger 的消费侧对账不再经过这里,但别的 op 仍在用,账表不动。
     */
    /** 即时售一枚丹药(仅限可炼丹;无丹方的事件丹无价) */
    function sellPill(pillId: string): boolean {
      return sellPillOnce(pillId, true)
    }

    /** 单枚卖出;fireOp=false 供批量走同一笔动作 */
    function sellPillOnce(pillId: string, fireOp: boolean): boolean {
      const def = pillDef(pillId)
      const inventory = useInventoryStore()
      if (!def?.recipe?.stoneBase || (inventory.pills[pillId] ?? 0) < 1) return false
      if (fireOp) reportAction('sell_pill', { id: pillId })
      inventory.spendPill(pillId, 1)
      useResourcesStore().addStone(pillSellPrice(pillId))
      return true
    }

    /** 即时售一批玄铁(与货架购入同单位数);灵草走 sellHerb */
    function sellMaterial(major: number): boolean {
      return sellMaterialOnce(major, true)
    }

    function sellMaterialOnce(major: number, fireOp: boolean): boolean {
      const resources = useResourcesStore()
      if (resources.ore < MARKET_MAT_COUNT) return false
      if (fireOp) reportAction('sell_material')
      resources.spendSmall('ore', MARKET_MAT_COUNT)
      resources.addStone(materialSellPrice(major))
      return true
    }

    /** 即时售一批任意品阶灵草(按该品计价) */
    function sellHerb(grade: HerbGrade): boolean {
      return sellHerbOnce(grade, true)
    }

    function sellHerbOnce(grade: HerbGrade, fireOp: boolean): boolean {
      const resources = useResourcesStore()
      if (resources.herbOf(grade) < MARKET_MAT_COUNT) return false
      if (fireOp) reportAction('sell_herb', { grade })
      resources.spendHerb(grade, MARKET_MAT_COUNT)
      resources.addStone(herbSellBatch(grade, usePlayerStore().major))
      return true
    }

    /**
     * 售尽某一味的全部存货:逐枚走同一个 sellPill,判据与计价都不分叉。
     * 后期丹匣常堆几十枚,一枚一枚点没有意义。
     * @returns 实售枚数与总所得;一枚也没卖出时枚数为 0
     */
    function sellPillAll(pillId: string): { count: number; stone: GNum } {
      const inventory = useInventoryStore()
      const before = inventory.pills[pillId] ?? 0
      let n = 0
      while (n < before && sellPillOnce(pillId, false)) n += 1
      if (n > 0) reportAction('sell_pill', { id: pillId, count: n })
      return { count: n, stone: n > 0 ? mulN(pillSellPrice(pillId), n) : gnZero() }
    }

    /**
     * 售尽某品灵草 / 玄铁:整摞计价,不足一摞即一枚也卖不出。
     * @returns 实售摞数
     */
    function sellHerbAll(grade: HerbGrade): number {
      const resources = useResourcesStore()
      const lots = Math.floor(resources.herbOf(grade) / MARKET_MAT_COUNT)
      let n = 0
      while (n < lots && sellHerbOnce(grade, false)) n += 1
      if (n > 0) reportAction('sell_all_herb', { grade, count: n })
      return n
    }

    function sellOreAll(major: number): number {
      const resources = useResourcesStore()
      const lots = Math.floor(resources.ore / MARKET_MAT_COUNT)
      let n = 0
      while (n < lots && sellMaterialOnce(major, false)) n += 1
      if (n > 0) reportAction('sell_all_ore', { count: n })
      return n
    }

    return {
      stock,
      stockedAt,
      consign,
      sanitize,
      sync,
      restockAt,
      buy,
      consignEquip,
      collectConsign,
      sellPill,
      sellMaterial,
      sellHerb,
      sellPillAll,
      sellHerbAll,
      sellOreAll
    }
  },
  { persist: persistConfig('market') }
)
