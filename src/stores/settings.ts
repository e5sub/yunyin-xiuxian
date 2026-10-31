import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { persistConfig } from '@/utils/storage'
import { asArray, asFiniteNumber, asRecord } from '@/utils/saveShape'
import { exploreModeOf } from '@/core/exploreModes'
import { bossDifficultyOf } from '@/data/bossDifficulty'
import { MAX_EQUIP_TIER } from '@/data/equipment'
import { QUALITIES } from '@/data/qualities'
import { APP_VERSION, compareVersions } from '@/utils/appVersion'
import { RELEASE_NOTES } from '@/ui/releaseNotes'

export const useSettingsStore = defineStore(
  'settings',
  () => {
    /** 上次看过发布说明的版本(空 = 从没看过) */
    const lastSeenVersion = ref('')
    const sfxOn = ref(true)
    const musicOn = ref(true)
    /** 音量 0~100,不是 0~1 */
    const musicVol = ref(50)
    const sfxVol = ref(70)
    /**
     * 减少动效:默认值从系统偏好(prefers-reduced-motion)播种;战斗回放是 JS 驱动的
     * (CombatPanel / GauntletPanel),只认这个应用内开关。
     * 播种只在无持久化档的首次创建生效,持久化水合随后盖回显式存下的 true/false。
     */
    const reduceMotion = ref(
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false
    )
    /** 遇事勿扰:历练撞见际遇/机缘/奇缘时不弹窗,立刻按默认好愿了结(与超时自动处置同一条路) */
    const dndEvents = ref(false)
    /**
     * VIP 托管自动化(core/autoOps 循环读取):四项开关独立,「历练优先于闭关」。
     * 开关本身持久化,但须 VIP 才能开;VIP 到期由 autoOps 循环复核后自动关停。
     */
    const autoBoss = ref(false)
    const autoRetreat = ref(false)
    const autoAdventure = ref(false)
    /**
     * 自动做每日活动(周天七会 + 闲趣三则)。
     * 只代办「不必玩家本人到场」的那一半:擂台连战、观星抽签、垂钓收篓、达标领赏;
     * 切磋要挑道友、秘境要选层数、猜谜只有一次机会,都不代做(见 core/autoOps 注释)。
     */
    const autoDailyEvent = ref(false)
    /** 自动历练的去处与档位('' = 未选;AUTO_REGION_ID 即 'auto' = 托管自行择地) */
    const autoRegionId = ref('')
    const autoMode = ref<import('@/types').ExploreMode>('normal')
    /** 围妖出剑难度档(手动出剑与托管代打同用;击杀赏格随档加深) */
    const bossDifficulty = ref<import('@/data/bossDifficulty').BossDifficulty>('normal')
    const battleSpeed = ref<1 | 2 | 4>(1)
    /** 一键分解勾选的品质 rank 列表 */
    const decomposeRanks = ref<number[]>([0, 1])
    /** 智能收纳:行囊自动去留规则(字段口径见 SmartKeepConfig) */
    const smartKeep = ref<import('@/core/smartKeep').SmartKeepConfig>({
      enabled: false,
      minQuality: 3,
      keepMinTier: 0,
      keepCoreAffix: true,
      keepComboPiece: true,
      keepPerfectRolls: true,
      keepSetPiece: true
    })
    /** 是否已同意隐私政策(欢迎页勾选后记录,老档视为已同意) */
    const privacyAccepted = ref(false)
    const theme = ref<'auto' | 'light' | 'dark'>('auto')
    /** iOS「添加到主屏幕」提示卡被玩家关掉过(关掉即不再出现) */
    const installNoticeDismissed = ref(false)

    /** 该不该亮「新版本/未读发布说明」:当前版本更新于上次看过的那版,且发布说明里确实有当前版本 */
    const hasUnseenRelease = computed(
      () =>
        RELEASE_NOTES.some(n => compareVersions(n.version, APP_VERSION) === 0) &&
        compareVersions(APP_VERSION, lastSeenVersion.value) > 0
    )

    /** 打开过发布说明:记成当前版本,新标记随之熄灭 */
    function markReleaseSeen(): void {
      lastSeenVersion.value = APP_VERSION
    }

    function sanitize(): void {
      musicVol.value = Math.min(100, asFiniteNumber(musicVol.value, 50, 0))
      sfxVol.value = Math.min(100, asFiniteNumber(sfxVol.value, 70, 0))
      if (![1, 2, 4].includes(battleSpeed.value)) battleSpeed.value = 1
      if (!['auto', 'light', 'dark'].includes(theme.value)) theme.value = 'auto'
      dndEvents.value = dndEvents.value === true
      autoBoss.value = autoBoss.value === true
      autoRetreat.value = autoRetreat.value === true
      autoAdventure.value = autoAdventure.value === true
      autoDailyEvent.value = autoDailyEvent.value === true
      autoRegionId.value = typeof autoRegionId.value === 'string' ? autoRegionId.value : ''
      autoMode.value = exploreModeOf(autoMode.value)
      bossDifficulty.value = bossDifficultyOf(bossDifficulty.value)
      // 布尔开关一律 ===true 归一:损坏档里混入的字符串("false")/数字(1)会以真值存活
      sfxOn.value = sfxOn.value === true
      musicOn.value = musicOn.value === true
      reduceMotion.value = reduceMotion.value === true
      privacyAccepted.value = privacyAccepted.value === true
      installNoticeDismissed.value = installNoticeDismissed.value === true
      lastSeenVersion.value = typeof lastSeenVersion.value === 'string' ? lastSeenVersion.value : ''
      decomposeRanks.value = [
        ...new Set(
          asArray<number>(decomposeRanks.value).filter(
            n => typeof n === 'number' && Number.isFinite(n) && QUALITIES.some(q => q.rank === n)
          )
        )
      ]
      const sk = asRecord<unknown>(smartKeep.value)
      smartKeep.value = {
        enabled: sk.enabled === true,
        /** 品质线须是真实存在的 rank:坏档写成 99 时没有一件装备达线,未达线的裸件被静默化尘;认不出回落默认「灵品」 */
        minQuality: (() => {
          const v = Math.floor(asFiniteNumber(sk.minQuality, 3, 0))
          return QUALITIES.some(q => q.rank === v) ? v : 3
        })(),
        keepMinTier: Math.max(0, Math.min(MAX_EQUIP_TIER, Math.floor(asFiniteNumber(sk.keepMinTier, 0, 0)))),
        keepCoreAffix: sk.keepCoreAffix !== false,
        keepComboPiece: sk.keepComboPiece !== false,
        keepPerfectRolls: sk.keepPerfectRolls !== false,
        keepSetPiece: sk.keepSetPiece !== false
      }
    }

    return {
      sfxOn,
      musicOn,
      musicVol,
      sfxVol,
      reduceMotion,
      dndEvents,
      autoBoss,
      autoRetreat,
      autoAdventure,
      autoDailyEvent,
      autoRegionId,
      autoMode,
      bossDifficulty,
      battleSpeed,
      decomposeRanks,
      smartKeep,
      privacyAccepted,
      theme,
      installNoticeDismissed,
      lastSeenVersion,
      hasUnseenRelease,
      markReleaseSeen,
      sanitize
    }
  },
  { persist: persistConfig('settings') }
)
