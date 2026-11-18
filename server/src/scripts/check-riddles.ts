/**
 * 猜谜题库体检:挂在 `bun run check` 里,与类型检查同批跑。
 *
 * 查的是「题库还能不能当题」——不看条数(条数随内容增删而变,钉死只会逼人改脚本),只看形状:
 * 每题四项且互不相同、答案下标在范围内、题面与注脚不空、题面不重。
 * 末一条查答案位置分布:防的是「新题一律 answer: 0」——那样玩家天天点甲就赢,题库再多也白搭。
 */
import { RIDDLES } from '../leisureRiddles.js'

/** 单一定位(甲/乙/丙/丁)最多占四成;超了就说明没有打散 */
const MAX_SLOT_SHARE = 0.4

function main(): void {
  const problems: string[] = []
  const seen = new Map<string, number>()

  RIDDLES.forEach((r, i) => {
    const at = `第 ${i + 1} 问`
    if (typeof r.q !== 'string' || r.q.trim() === '') problems.push(`${at}:题面为空`)
    if (typeof r.note !== 'string' || r.note.trim() === '') problems.push(`${at}:注脚为空`)
    if (!Array.isArray(r.options) || r.options.length !== 4) {
      problems.push(`${at}:选项应为四项,实为 ${r.options?.length ?? 0}`)
      return
    }
    if (new Set(r.options).size !== r.options.length) problems.push(`${at}:选项里有重复项 —— ${r.q}`)
    if (r.options.some(o => typeof o !== 'string' || o.trim() === '')) problems.push(`${at}:有空选项 —— ${r.q}`)
    if (!Number.isInteger(r.answer) || r.answer < 0 || r.answer >= r.options.length) {
      problems.push(`${at}:答案下标越界(${r.answer})—— ${r.q}`)
    }
    const prev = seen.get(r.q)
    if (prev !== undefined) problems.push(`${at}:与第 ${prev + 1} 问题面重复 —— ${r.q}`)
    else seen.set(r.q, i)
  })

  if (RIDDLES.length === 0) problems.push('题库是空的')

  // 答案位置分布:四种定位都要有人站,且没有一种占到四成以上
  const slots = [0, 0, 0, 0]
  for (const r of RIDDLES) {
    const at = slots[r.answer]
    if (at !== undefined) slots[r.answer] = at + 1
  }
  const share = RIDDLES.length === 0 ? 0 : Math.max(...slots) / RIDDLES.length
  if (RIDDLES.length > 0 && share > MAX_SLOT_SHARE) {
    const worst = slots.indexOf(Math.max(...slots))
    problems.push(
      `答案位置失衡:${'甲乙丙丁'[worst]}项占 ${(share * 100).toFixed(0)}%(上限 ${MAX_SLOT_SHARE * 100}%)`
      + ' —— 新题请把正确项按题面哈希散到四个位置,别一律塞第一项'
    )
  }

  if (problems.length > 0) {
    console.error(`猜谜题库体检查出 ${problems.length} 处问题:`)
    for (const p of problems.slice(0, 20)) console.error(`  · ${p}`)
    if (problems.length > 20) console.error(`  ...另有 ${problems.length - 20} 处`)
    process.exit(1)
  }

  console.log(`猜谜题库体检通过:${RIDDLES.length} 问,答案位置分布 ${slots.join('/')}`)
}

main()
