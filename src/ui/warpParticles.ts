/**
 * 穿梭传送门的粒子快照;随机值只在 show() 时取一次。
 * 放进模板 style 绑定会随父组件重渲染重掷,粒子跳位。
 */
export interface WarpParticleStyles {
  stars: Record<string, string>[]
  lines: Record<string, string>[]
}

export function buildWarpParticleStyles(
  starCount: number,
  lineCount: number,
  random: () => number = Math.random
): WarpParticleStyles {
  const stars = Array.from({ length: starCount }, (_, i) => {
    const angle = ((i + 1) / starCount) * 360
    const distance = 20 + random() * 80
    const size = 1 + random() * 2
    const delay = random() * 0.5
    const duration = 0.8 + random() * 0.4
    return {
      '--angle': `${angle}deg`,
      '--distance': `${distance}%`,
      '--size': `${size}px`,
      '--delay': `${delay}s`,
      '--duration': `${duration}s`
    }
  })

  const lines = Array.from({ length: lineCount }, (_, i) => {
    const angle = ((i + 1) / lineCount) * 360
    const length = 100 + random() * 200
    const delay = random() * 0.3
    return {
      '--angle': `${angle}deg`,
      '--length': `${length}px`,
      '--delay': `${delay}s`
    }
  })

  return { stars, lines }
}
