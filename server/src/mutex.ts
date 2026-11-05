/**
 * 进程内按键串行闸 —— 收「读-判-写」之间的并发窗口。
 *
 * 本服务是单实例(Node 单进程,内存里已有 WS 广播表、限速桶、在途闸),
 * 因此进程内锁与数据库事务在本场景等效,且不必为 sqlite / mysql 各写一套事务语法。
 * 若将来改成多实例(cluster / pm2 -i),这些窗口要改回数据库条件更新才算真正收口。
 *
 * 用法:同一 key 的 fn 严格串行;前一个抛错不影响后一个入队。
 */
const tails = new Map<string, Promise<unknown>>()

/** 按键串行执行:返回 fn 自身的结果(异常照常抛给调用方) */
export function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve()
  // prev 恒为「已吞掉异常」的尾部标记,故只挂成功回调;失败不能让队列断掉
  const result = prev.then(() => fn())
  const tail = result.catch(() => undefined)
  tails.set(key, tail)
  void tail.then(() => {
    // 队列走空后清键:否则按 uid 的 Map 会随注册人数无上限增长
    if (tails.get(key) === tail) tails.delete(key)
  })
  return result
}
