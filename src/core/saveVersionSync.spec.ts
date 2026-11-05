/**
 * 客户端与服务端「各自手写一份、漏一处就静默坏」的跨端常量对齐判据。
 *
 * 1) 存档结构版本:客户端 SAVE_VERSION(src/utils/storage.ts)与服务端上传闸门
 *    CLIENT_SAVE_VERSION(server/src/routes/save.ts)必须一致。服务端放得太宽,
 *    毒化客户端上传 version=9999 也能落库,任何存量客户端都拉不回这份档;
 *    服务端钳得太紧,客户端升版本后全员 400。
 * 2) 持久化分片 ↔ 归一化步骤:新增持久化 store 若只进 PERSISTED_STORES 而漏登
 *    SAVE_SANITIZE_STEPS(saveSanitize.ts),本地持久化、导出、上传都带这个分片,
 *    但服务端归一化与客户端 sanitizeAll 都跳过它 —— 坏字段直接进云档、下发到所有设备。
 *    (saveRoundTrip 只钉了 PERSISTED_STORES ↔ persistConfig,这里补另一半。)
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const STORAGE = readFileSync(resolve(ROOT, 'src/utils/storage.ts'), 'utf-8')
const SAVE_ROUTE = readFileSync(resolve(ROOT, 'server/src/routes/save.ts'), 'utf-8')
const SANITIZE = readFileSync(resolve(ROOT, 'src/core/saveSanitize.ts'), 'utf-8')

function constNumber(source: string, name: string): number {
  const m = new RegExp(`const ${name} = (\\d+)`).exec(source)
  if (m === null) throw new Error(`找不到 const ${name} —— 改名了?这份判据要跟着改`)
  return Number(m[1])
}

/** `export const NAME = [...]` 名单里的引号字符串项(先按行剥注释再提取,防注释里的引号串味) */
function listNames(source: string, name: string): string[] {
  const m = new RegExp(`export const ${name}[^=]*= \\[([\\s\\S]*?)\\]`).exec(source)
  if (m === null) throw new Error(`找不到 export const ${name} —— 改名了?这份判据要跟着改`)
  const body = m[1]!
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n')
  return [...body.matchAll(/'([^']+)'/g)].map(x => x[1]!)
}

describe('跨端存档常量对齐', () => {
  it('客户端 SAVE_VERSION 与服务端 CLIENT_SAVE_VERSION 一致', () => {
    expect(constNumber(STORAGE, 'SAVE_VERSION')).toBe(constNumber(SAVE_ROUTE, 'CLIENT_SAVE_VERSION'))
  })

  it('PERSISTED_STORES 与 SAVE_SANITIZE_STEPS 的分片集合一致', () => {
    const persisted = listNames(STORAGE, 'PERSISTED_STORES')
    const steps = listNames(SANITIZE, 'SAVE_SANITIZE_STEPS')
    expect(persisted).toEqual(expect.arrayContaining(steps))
    expect(steps).toEqual(expect.arrayContaining(persisted))
  })
})
