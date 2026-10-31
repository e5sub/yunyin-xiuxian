/**
 * 闲趣三则路由:观星、垂钓、猜谜。
 * 结果与次数全在服务端,客户端只负责呈现与把赏入账。
 */
import express, { type Request, type Response } from 'express'
import { requireAuth } from '../auth.js'
import {
  answerRiddle,
  castLine,
  claimBasket,
  drawStar,
  leisureEnabled,
  leisureToday
} from '../leisureCore.js'

export const leisureRouter = express.Router()

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
    res.json(await drawStar(req.user!.id))
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
    res.json(r)
  })().catch(() => res.status(500).json({ error: '答谜失败' }))
})
