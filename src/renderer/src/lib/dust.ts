export interface DustParticle {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  a: number
}

const MAX_PARTICLES = 120

/** 生成浮尘粒子（慢漂、低透明度）；数量夹住上限，random 可注入便于测试。 */
export function seedParticles(
  count: number,
  width: number,
  height: number,
  random: () => number = Math.random
): DustParticle[] {
  const n = Math.min(MAX_PARTICLES, Math.max(0, Math.trunc(count)))
  const particles: DustParticle[] = []
  for (let i = 0; i < n; i++) {
    particles.push({
      x: random() * width,
      y: random() * height,
      vx: (random() - 0.5) * 0.15,
      vy: (random() - 0.5) * 0.15 - 0.03,
      r: random() * 1.5 + 0.5,
      a: random() * 0.3 + 0.1
    })
  }
  return particles
}
