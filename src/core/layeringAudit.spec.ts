/* eslint-disable no-console -- 分层审计的产出是给人看的清单 */
/**
 * 分层审计:core 对 store 的依赖只许收拢,不许扩散。
 *   一 `STATEFUL_CORE` 与当前 import store 的 core 模块逐一相等,新增或遗留都红。
 *      基线用名单不用计数:计数能被搬位置绕过。
 *   二 引用处数不超过基线。
 *   三 `utils` 不许 import core / stores。
 *   四 `data` 不许反向 import core / stores / ui。
 *
 * 故障注入:在名单外的 core 模块加 `import { usePlayerStore } from "@/stores/player"`,
 * 第一条红;在 src/utils 夹一句对 core/store 的 import,第三条红。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const CORE = resolve(__dirname);
const UTILS = resolve(__dirname, "../utils");
const DATA = resolve(__dirname, "../data");

/** core 里 import store 的语句;单双引号都认 */
const STORE_IMPORT = /from\s+["']@\/stores\/[A-Za-z]+["']/g;

/** 允许 import store 的 core 模块点名清单(只许减);名字是含 `.ts` 的文件名 */
const STATEFUL_CORE = new Set<string>([
  // 权威推进(1.75.0):心跳生产/历练战斗/离线结算的服务端裁决,水合 17 分片必然读 store
  // 动作结算(1.78.0):服务端在云档上跑客户端同一份结算代码,水合 17 分片是它的前提
  "actionOps.ts",
  // 同上:上报与重对齐要按分片找 store(与 engine 的心跳回传同一张表)
  "remoteAction.ts",
  // 分片 ↔ store 的唯一清单(advanceResolve / actionOps / engine 三处共用)
  "sliceStores.ts",
  "advanceResolve.ts",
  "affixTransfer.ts",
  "astronomy.ts",
  "autoOps.ts",
  "bossLoot.ts",
  "breakthrough.ts",
  "breakthroughResolve.ts",
  "buildDetect.ts",
  "buildingService.ts",
  "challenge.ts",
  "craftability.ts",
  "dailyChallenge.ts",
  "daoluService.ts",
  "divinationService.ts",
  "earlyGameService.ts",
  "endgameService.ts",
  "engine.ts",
  "equipBest.ts",
  "eventEngine.ts",
  "expedition.ts",
  "exploration.ts",
  "forge.ts",
  // 炼器收进服务端裁决(1.58.3):无头裁决与水合必然要读这几本账,
  // 两个文件的分工见各自头注(一个跑纯账层,一个管客户端编排与提示)
  "forgeResolve.ts",
  "forgeService.ts",
  // 升级收进服务端裁决(1.59.0):功法进修/建筑升级的纯账层,与 forgeResolve 同构;
  // 客户端编排留在 gongfaService / buildingService(已在名单里)
  "levelResolve.ts",
  "fortuneChain.ts",
  "fortuneEcho.ts",
  "firstStep.ts",
  "goal.ts",
  "gongfaService.ts",
  "heritageForge.ts",
  "identity.ts",
  "identityService.ts",
  "lab.ts",
  "lifeTrialService.ts",
  "loadoutService.ts",
  "loot.ts",
  "lootClaim.ts",
  "loreService.ts",
  "mentorService.ts",
  "mortalWorldService.ts",
  "offline.ts",
  "pillService.ts",
  "playerSnap.ts",
  "profileRecompute.ts",
  "progress.ts",
  "questProgress.ts",
  "qiRepair.ts",
  "reforge.ts",
  "regionEvent.ts",
  "regionRevival.ts",
  "reincarnation.ts",
  "resourceGuidance.ts",
  "samsaraService.ts",
  "saveSanitize.ts",
  "cloudSave.ts",
  "secretRealm.ts",
  "smartKeep.ts",
  "soulService.ts",
  "suppress.ts",
  "tribulationDecision.ts",
  "veinService.ts",
  "weather.ts",
  "worldMemory.ts",
]);

/** core → store 的引用处数基线(只许减;名单没变时防止单个模块越挂越多) */
/*
 * 1.67.0:246 → 248。两处都是把「改数值」的动作收进服务端带来的合法依赖 ——
 *   · core/levelResolve 读 inventory:祭炼重数与灵脉点数都要经同一条无头结算链改 store;
 *   · core/veinService 读 auth:登录态走 progress/op,未登录才走本地链(同 forgeService 的既有做法)。
 * 1.68.0:248 → 249。core/profileRecompute 读 sect:门派状态服务端独占、不在存档分片里,
 *   复算战力/掉落环境要把表里的状态水合进 store —— 不注进去,服务端快照就比玩家面板少一截。
 * 1.74.2:249 → 250。core/offline 读 sect:离线结算里的门派产量三座(灵草园/玄铁矿/悟道堂)
 *   要按门派建筑等级计产,而门派状态不在存档分片里 —— 结算前先补拉一次(见 offline.ts produce 前)。
 * 1.74.4:250 → 251。core/autoOps 读 inventory:装备托管以「行囊满」为触发,
 *   bagFull 是 inventory 的派生,托管巡检读它才算真满(自算容量必与 store 分叉)。
 * 1.75.0:251 → 280。core/advanceResolve 读 17 分片(水合=推进=diff 的同一张清单),
 *   core/engine 读 12 个新分片(心跳回传的 $patch 要按分片找 store)。
 * 1.78.0:280 → 293。分片清单抽成 core/sliceStores 单点(actionOps 与 advanceResolve 共用),
 *   17 处引用从 advanceResolve 搬到这里 —— 处数不变只换了文件;净增来自
 *   core/actionOps 的动作层要直接读写 player/inventory/cultivation/market/apprentice/adventure。
 * 1.79.19(+3,294 → 297)。修「修为和灵气一直存不满」:三条服务端权威链(推进/动作/突破)
 *   的无头水合此前都漏了门派状态(门派不进存档分片、整份只住服务端表),服务端复算的
 *   cultPerSec / qiRegenPerSec / qiCapValue / 战力比玩家面板低一截,心跳补丁每拍把客户端
 *   涨好的值拽回去。现与 profileRecompute 同一条口子:useSectStore().hydrate(sect) 注进来,
 *   advanceResolve / actionOps / breakthroughResolve 各 +1 处引用。
 */
const CORE_STORE_SITES = 297;
/**
 * core 用例里需要 Pinia 的文件数基线(只许减)。
 * 上游 121 + 本仓 autoOpsDaily/gongfaSeats 等新增,合并后以实跑数为准,见本文件底部对账。
 * 1.58.3 的 forgeResolve.spec 也是 +1:无头水合必须真开一个 pinia(与 breakthroughResolve 同构)。
 * 1.59.0 的 levelResolve.spec 同理 +1(升级裁决的同一份水合)。
 * 1.62.0 的 cloudSave.spec 再 +1:corrections 回传的回归判据必须真 $patch store
 * (三段路径毁档修复,合并逻辑以现对象为底,不动真 store 测不出来)。
 * 1.66.3 的 forgeServiceCharge.spec +1:在线炼器的料耗落账要真扣 store
 * (服务端只回「该付多少」,扣款在客户端 —— 不打桩测不出漏扣)。
 * 1.68.0(+1,131 → 132):上游这批带来的 voidRerollRebirth.spec —— `rerollVoidWorld` 读
 * endgame/ui 两个 store、`onRebirth` 本身也是 store 方法,这条「await 窗口里转世」的
 * 时序判据绕不开 Pinia(上游自己在同一处把它的基线从 121 调到 122,理由相同)。
 * 1.74.0(+1,132 → 133):settleQueue.spec —— 乱序落账是**跨 store 的余额**问题,
 * 断言本身就是「连点两下之后灵石还剩多少」,不打真 store 测不出来(与 forgeServiceCharge 同因)。
 * 1.74.1(+2,133 → 135):autoOpsApprentice.spec(托管收派道童走 store 动作)与
 * expeditionAuto.spec(全自动远征的额度记在 endgame store、续行走 store 状态机)。
 * 1.74.4(+1,135 → 136):autoOpsEquip.spec —— 装备托管以「行囊满」为触发、换装配与化尘都走
 * inventory store 的真账,不打真 store 测不出「换下的旧件当轮化尘」这条次序判据。
 * 1.75.0(+1,136 → 137):advanceResolve.spec —— 从分片水合再推进再 diff,判据就是
 * 「水合后的 store 数值变了多少」,不开真 pinia 测不出来(与 breakthroughResolve 同构)。
 */
const CORE_PINIA_SPECS = 138;

function sources(dir: string): { name: string; text: string }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"))
    .map((f) => ({ name: f, text: readFileSync(join(dir, f), "utf8") }));
}

describe("分层 · core 对 store 的依赖只许收拢", () => {
  const core = sources(CORE);
  const withStore = core
    .map((f) => ({ name: f.name, hits: f.text.match(STORE_IMPORT) ?? [] }))
    .filter((f) => f.hits.length > 0);
  const sites = withStore.reduce((n, f) => n + f.hits.length, 0);

  it("扫描到了 core 源码(防空转)", () => {
    expect(core.length).toBeGreaterThan(50);
  });

  it("import store 的 core 模块 = 点名名单(新增或遗留都要在这里显式改)", () => {
    const actual = withStore.map((f) => f.name).sort();
    const baseline = [...STATEFUL_CORE].sort();
    const added = actual.filter((n) => !STATEFUL_CORE.has(n));
    const leftover = baseline.filter((n) => !actual.includes(n));
    if (added.length > 0)
      console.log(`\n新增的 core → store 模块(把纯模块拖下水?):${added.join("、")}`);
    if (leftover.length > 0)
      console.log(
        `\n已迁走、该从名单删掉的:${leftover.join("、")}\n` +
          `  (那一个是好事 —— 从 STATEFUL_CORE 里删掉它)`,
      );
    expect(actual).toEqual(baseline);
  });

  it("import store 的处数不超过基线", () => {
    if (sites > CORE_STORE_SITES) {
      const per = new Map<string, number>();
      for (const f of withStore) {
        for (const hit of f.hits) {
          const store = hit.replace(/^.*@\/stores\//, "").replace(/["']$/, "");
          per.set(store, (per.get(store) ?? 0) + 1);
        }
      }
      console.log(
        `\ncore → store 的引用分布(基线 ${CORE_STORE_SITES},现在 ${sites}):` +
          [...per.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `\n  ${k} ×${v}`)
            .join(""),
      );
    }
    expect(sites).toBeLessThanOrEqual(CORE_STORE_SITES);
  });

  it("core 用例需要 Pinia 的文件数不超过基线(只许减)", () => {
    const specs = readdirSync(CORE).filter(
      (f) => f.endsWith(".spec.ts") && f !== "layeringAudit.spec.ts",
    );
    const withPinia = specs.filter((f) =>
      readFileSync(join(CORE, f), "utf8").includes("setActivePinia"),
    );
    console.log(`\ncore 用例 ${specs.length} 个,其中 ${withPinia.length} 个要 Pinia`);
    expect(withPinia.length).toBeLessThanOrEqual(CORE_PINIA_SPECS);
  });

  it("utils 不依赖 core / stores —— 最底层只认自己与标准库", () => {
    const bad = sources(UTILS).filter((f) =>
      /from\s+["']@\/(core|stores)\//.test(f.text),
    );
    expect(bad.map((f) => f.name)).toEqual([]);
  });

  it("data 不反向依赖 core / stores / ui —— 唯一事实源只许静态声明", () => {
    // 只看运行时代码;spec 里 import core 对账允许
    const bad = sources(DATA).filter((f) =>
      /from\s+["']@\/(core|stores|ui)\//.test(f.text),
    );
    expect(
      bad.map((f) => f.name),
      "data 是纯静态声明式内容:反向 import 会让数据层带上副作用与显示口径",
    ).toEqual([]);
  });
});
