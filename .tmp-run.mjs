import { createVitest } from 'vitest/node'
const v = await createVitest('test', { watch: false, run: true })
await v.start(['src/.tmp-gf2.spec.ts'])
process.exit(0)
