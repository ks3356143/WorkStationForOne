import { DustField } from './DustField'

/** 全局氛围特效：极光漂移 / HUD 网格 / 浮尘（背景层）+ 胶片颗粒（顶层）。均不参与交互。 */
export function AmbientEffects() {
  return (
    <>
      <div className="w1-fx" aria-hidden="true">
        <div className="w1-aurora">
          <i />
          <i />
          <i />
        </div>
        <div className="w1-grid" />
        <DustField />
      </div>
      <div className="w1-grain" aria-hidden="true" />
    </>
  )
}
