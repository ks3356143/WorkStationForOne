import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useEffect } from 'react'
import { useWorkstation } from '../store/useWorkstation'

/**
 * 列表容器的增删移交给 auto-animate（成熟零配置库，自动尊重系统 reduced-motion）。
 * 跟随应用动效总闸 motionOn；虚拟滚动列表（笔记固定行高 / Agent 增量线程）不要用。
 * 返回挂到「直接包含映射子元素」的容器 ref。
 */
export function useListAnimate<T extends Element = HTMLElement>() {
  const motionOn = useWorkstation((state) => state.motionOn)
  const [parent, setEnabled] = useAutoAnimate<T>({ duration: 220, easing: 'ease-out' })
  useEffect(() => {
    setEnabled(motionOn)
  }, [motionOn, setEnabled])
  return parent
}
