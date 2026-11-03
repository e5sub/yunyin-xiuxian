/**
 * 客户端共享模块装载(saveSanitize / saveAuthority / profileRecompute / breakthroughResolve)。
 *
 * 两条路:
 *  - 源码:开发环境仓库根在场,tsx 按 tsconfig paths 解析 `@/` 别名 —— 永远优先,改代码即时生效;
 *  - vendor:生产镜像只复制了 server/,src/ 源码不存在 —— 1.57.1 前反作弊三层因此在容器里
 *    全部静默失效(fail-open 回落把加固架空)。构建期用 esbuild 把共享模块打成
 *    server/vendor/*.mjs 随镜像分发(见 package.json 的 build:vendor 与两个 Dockerfile),这里兜底。
 *
 * 两条都失败时原样抛错,由调用方按各自「加固不拒收」的回落链路处理并留痕。
 */
export async function loadClientModule<T>(sourceSpec: string, vendorFile: string): Promise<T> {
  try {
    return (await import(sourceSpec)) as T
  } catch {
    return (await import(`./vendor/${vendorFile}.mjs`)) as T
  }
}
