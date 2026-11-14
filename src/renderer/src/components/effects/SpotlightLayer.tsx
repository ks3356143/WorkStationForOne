/** 聚光层：绝对定位、跟随指针的半透明光斑 + 1px 描边光环；不参与布局。 */
export function SpotlightLayer() {
  return (
    <>
      <span className="w1-spot" aria-hidden="true" />
      <span className="w1-spotborder" aria-hidden="true" />
    </>
  )
}
