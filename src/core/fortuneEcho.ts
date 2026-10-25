/**
 * 遗产回声:曾放弃的机缘再次出现时,低概率替换为回声叙事。
 * 边界:只读 fortuneChoices;不新增资源 / 属性 / 奖励 / 战斗规则 / 独立 UI。
 * 规则:仅曾 leave 可回声;take 不触发;多次 leave 不叠加;回声不进入推荐。
 */
import { usePlayerStore } from '@/stores/player'
import { aftermathText, shouldTriggerAftermath } from './worldMemory'
import type { EventMemory } from '@/types'

export const ECHO_CHANCE = 0.05

/** 回声形态:认出你 / 缘分已尽 / 留下痕迹 */
export type EchoForm = 'recognize' | 'fate-over' | 'traces'

export interface FortuneEcho {
  eventId: string
  form: EchoForm
  /** 导语,显示在抉择文案上方 */
  line: string
}

/**
 * 一次事件打开的叙事快照,事件 id 变化时重建。
 * EventDialog 常驻全局:掷骰放 computed 会随重渲染重掷,放组件级布尔量会继承上一件。
 */
export interface EventNarrative {
  eventId: string
  echo: FortuneEcho | null
  aftermath: string | null
}

const FORTUNE_ECHO_TEXTS: Record<string, { form: EchoForm; line: string }> = {
  ft_reclusive_elder: {
    form: 'recognize',
    line: '竹屋前的老人抬眼望来,目光在你面上停了一瞬:「原来是你。」'
  },
  ft_sword_remnant: {
    form: 'traces',
    line: '三道剑痕犹在。你曾在此绕道而去。'
  },
  ft_ancient_elixir: {
    form: 'fate-over',
    line: '你放回原处的那卷丹方,无人动过。'
  },
  ft_beast_pledge: {
    form: 'recognize',
    line: '你曾放走的那头幼兽,又寻来了。'
  },
  ft_blood_contract: {
    form: 'traces',
    line: '你亲手挖的土坑空了。'
  },
  ft_xianmen_guqin: {
    form: 'traces',
    line: '古琴仍在案上。你曾在这里坐了一晌,终究没有伸手。'
  },
  ft_yunduan_xianzun: {
    form: 'recognize',
    line: '云端那位仙尊又在负手而立,瞥见你时笑了笑:「这回,还是不拜?」'
  },
  ft_shenyu_wangzuo: {
    form: 'fate-over',
    line: '王座依旧悬在神域中央。你曾绕它而行。'
  },
  ft_faze_zhixin: {
    form: 'traces',
    line: '那枚光核还在跳动。你曾只是看着它,没有碰。'
  },
  ft_hundun_zhong: {
    form: 'recognize',
    line: '你埋回去的那粒种子,又回到了眼前。'
  },
  ft_hongmeng_xiantai: {
    form: 'fate-over',
    line: '你曾在台前退开一步,那笔账至今未结。'
  }
}

/** 机缘是否有回声资格(曾放弃) */
export function echoEligible(eventId: string): boolean {
  return usePlayerStore().fortuneChoices[eventId] === 'leave'
}

/** 组装回声;无回声文本则 null */
export function echoFor(eventId: string): FortuneEcho | null {
  if (!echoEligible(eventId)) return null
  const data = FORTUNE_ECHO_TEXTS[eventId]
  if (!data) return null
  return { eventId, form: data.form, line: data.line }
}

/**
 * 掷定一次事件打开期间的叙事快照;每个事件只调用一次。
 * 回声与余波互斥,掷骰顺序固定:先回声、再余波。roll 可注入。
 */
export function rollEventNarrative(
  eventId: string,
  eventTitle: string,
  eventMemories: Record<string, EventMemory>,
  roll: () => number
): EventNarrative {
  const echo = eventId.startsWith('ft_') && roll() < ECHO_CHANCE ? echoFor(eventId) : null
  if (echo) return { eventId, echo, aftermath: null }

  const memory = eventMemories[eventId]
  const aftermath =
    memory && shouldTriggerAftermath(eventMemories, eventId, roll())
      ? aftermathText(eventTitle, memory.times >= 3 ? 'good' : memory.times >= 2 ? 'echo' : 'silence')
      : null
  return { eventId, echo: null, aftermath }
}
