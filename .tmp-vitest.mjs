import { createVitest } from 'vitest/node'
const filters = process.argv.slice(2)
const vitest = await createVitest('test', { watch: false, run: true })
await vitest.start(filters.length > 0 ? filters : [])
await vitest.close()
process.exit(0)
