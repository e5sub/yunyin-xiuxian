import { readFileSync, writeFileSync } from 'node:fs'
const p = 'src/data/gongfa.ts'
const s = readFileSync(p, 'utf8')
const from = '{ attackPct: 0.44, defensePct: 0.44, maxHpPct: 0.41 }'
const to = '{ attackPct: 0.42, defensePct: 0.42, maxHpPct: 0.39 }'
if (!s.includes(from)) { console.log('锚点未命中或已改过'); process.exit(0) }
writeFileSync(p, s.replace(from, to))
console.log('ok')
