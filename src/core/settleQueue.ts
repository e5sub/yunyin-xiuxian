/**
 * 结算闸(1.74.0) —— 同一时刻只跑一笔「读本地余额 → 请求服务端 → 落本地账」。
 *
 * 为什么要有(「强化与升级有时候清空灵石」的真因):
 *   钱是客户端本地扣的,服务端判「付得起」用的却是请求里带的那份余额。两笔结算同时在途时,
 *   两笔都带着**同一份还没扣过**的余额出门 —— 服务端各自判付得起、各自按全额记账,
 *   本地回到第二笔时余额已经不够,`subClamp` 直接压到 0:玩家看着灵石清零。
 *   连点「强化 / 一键强化」正是这个形状(同一个 RTT 里点两下),而一键强化一次就是全身的价,
 *   双扣足以把余额吃干。另有一层:同一个 op 的在途 promise 曾被多个调用方共用,
 *   服务端只结算一笔、本地却按回传的 spend 扣了 N 次 —— 见 forgeService 的 1.74.0 注释。
 *
 * 两条规矩,新增结算链照抄:
 *   1. **请求与落账同住一笔任务**(task 内部完成),不许在 await 之后另扣 ——
 *      落账留在闸外,后一笔读到的就是扣之前的余额,等于把闸拆了;
 *   2. **只有一处落账点**:谁来等这个结果都不影响扣款次数。
 */
import { readonly, ref } from 'vue'
import type { LevelOpResponse } from '@/services/cloud'
import { applyLevelSlices } from './levelResolve'

let chain: Promise<unknown> = Promise.resolve()
const inflight = ref(0)

const noop = (): void => {}

/** 在途结算笔数(只读):UI 拿它禁掉「再点一次」的钮 */
export const settling = readonly(inflight)

/**
 * 排进结算队列。task 必须自己完成落账 —— 这样上一笔的账在下一次读余额之前就已经扣掉。
 * 队列不吞异常:task 抛错照样往后走(链条自己接住),调用方照常拿到 reject。
 */
export function runSettlement<T>(task: () => Promise<T>): Promise<T> {
  inflight.value += 1
  const run = chain.then(task, task)
  chain = run.then(noop, noop)
  void run.then(
    () => {
      inflight.value -= 1
    },
    () => {
      inflight.value -= 1
    }
  )
  return run
}

/**
 * 升级类结算(建筑 / 功法 / 法宝 / 灵脉):排队 → 请求 → 成功即在闸内覆盖本地分片。
 * 失败与网络异常一律回 null(调用方照旧出「未能结算」),不在这里弹提示。
 */
export function settleLevelRequest(send: () => Promise<LevelOpResponse>): Promise<LevelOpResponse | null> {
  return runSettlement(async () => {
    try {
      const res = await send()
      if (res.ok) applyLevelSlices(res.slices)
      return res
    } catch {
      return null
    }
  })
}
