/**
 * 闲趣三则路由:观星、垂钓、猜谜。
 * 结果与次数全在服务端,客户端只负责呈现与把赏入账。
 * 赏格落档(1.79.12):抽签/收篓/答对的那一刻由服务端把赏写进云档 ——
 * 此前「回传数值、客户端本地入账」在抛弃存档后全是蒸发(台账不记、云档不动)。
 */
import express, { type Request, type Response } from 'express'
import { requireAuth } from '../auth.js'
import { run } from '../db.js'
import { creditEventReward, rewardIsEmpty } from '../saveCredit.js'
import {
  answerRiddle,
  castLine,
  claimBasket,
  drawStar,
  leisureEnabled,
  leisureToday
} from '../leisureCore.js'
import { dayKeyOf } from '../eventCore.js'

export const leisureRouter = express.Router()

/**
 * 落档失败回滚当日标记(1.79.18):三则的「抽过/收过/答过」都先标记、后落档,
 * 吞掉落档失败这笔赏就蒸发且当日不可再来。回滚只动当日那行,重试即重发。
 */
async function rollbackToday(userId: number, kind: 'star' | 'fish' | 'riddle', clearTries: boolean): Promise<void> {
  const day = dayKeyOf(Date.now())
  if (clearTries) {
    await run('UPDATE leisure_log SET tries = 0, claimed = 0 WHERE user_id = ? AND day = ? AND kind = ?', [
      userId,
      day,
      kind
    ])
    return
  }
  await run('UPDATE leisure_log SET claimed = 0 WHERE user_id = ? AND day = ? AND kind = ?', [userId, day, kind])
}

leisureRouter.get('/today', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    res.json(await leisureToday(req.user!.id))
  })().catch(() => res.status(500).json({ error: '闲趣名册拉取失败' }))
})

/** 观星:一日一签,抽过再点只回看 */
leisureRouter.post('/star', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    if (!(await leisureEnabled())) {
      res.status(404).json({ error: '闲趣暂闭' })
      return
    }
    const r = await drawStar(req.user!.id)
    if (!r.already && !rewardIsEmpty(r.reward)) {
      const credited = await creditEventReward(req.user!.id, r.reward).catch(() => false)
      if (!credited) {
        // 签文按 (userId, day) 确定性生成,回滚后重抽同签,不构成重抽刷赏
        await rollbackToday(req.user!.id, 'star', true)
        res.status(500).json({ error: '落档失败,请重试' })
        return
      }
    }
    res.json(r)
  })().catch(() => res.status(500).json({ error: '今夜无星' }))
})

/** 垂钓:起一竿,钓获先入篓 */
leisureRouter.post('/fish', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    if (!(await leisureEnabled())) {
      res.status(404).json({ error: '闲趣暂闭' })
      return
    }
    const r = await castLine(req.user!.id)
    if (r === null) {
      // 三竿用尽,或今日已收篓 —— 两种都是「没得钓了」
      res.status(400).json({ error: '今日鱼事已了' })
      return
    }
    res.json(r)
  })().catch(() => res.status(500).json({ error: '起竿失败' }))
})

/** 收篓:把今日累计钓获一次入账 */
leisureRouter.post('/fish/claim', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    if (!(await leisureEnabled())) {
      res.status(404).json({ error: '闲趣暂闭' })
      return
    }
    const reward = await claimBasket(req.user!.id)
    if (reward === null) {
      res.status(400).json({ error: '篓已收过' })
      return
    }
    if (!rewardIsEmpty(reward)) {
      const credited = await creditEventReward(req.user!.id, reward).catch(() => false)
      if (!credited) {
        // 鱼获明细在标记时已被条件更新清零,回滚只能放开 claimed 让赏按下次实况重结
        await rollbackToday(req.user!.id, 'fish', false)
        res.status(500).json({ error: '落档失败,请重试' })
        return
      }
    }
    res.json({ reward })
  })().catch(() => res.status(500).json({ error: '收篓失败' }))
})

/** 猜谜:四选一,一问一次 */
leisureRouter.post('/riddle', requireAuth, (req: Request, res: Response) => {
  void (async () => {
    if (!(await leisureEnabled())) {
      res.status(404).json({ error: '闲趣暂闭' })
      return
    }
    const choice = Number((req.body as { choice?: unknown } | undefined)?.choice)
    const r = await answerRiddle(req.user!.id, choice)
    if (r === null) {
      res.status(400).json({ error: '选项不对' })
      return
    }
    // 答错的赏为零,creditGains 对全零直接跳过 —— 但答错也有安慰赏(stone 20),同样判落档
    if (!rewardIsEmpty(r.reward)) {
      const credited = await creditEventReward(req.user!.id, r.reward).catch(() => false)
      if (!credited) {
        // 一问一次:回滚 tries 让玩家重新作答(落档失败是低频 DB 抖动,可接受重答)
        await rollbackToday(req.user!.id, 'riddle', true)
        res.status(500).json({ error: '落档失败,请重试' })
        return
      }
    }
    res.json(r)
  })().catch(() => res.status(500).json({ error: '答谜失败' }))
})
