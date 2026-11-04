import { useEffect, useState } from 'react'
import type { AgentImageRef } from '../../../../shared/ipc'
import { loadAgentImage } from '../../lib/image-cache'

/** 图片本体在应用私有目录；渲染层通过窄桥按 id 读取 data URL，结果走共享缓存。 */
export function useAgentImage(image: AgentImageRef | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!image) {
      setUrl(null)
      return
    }
    let alive = true
    void loadAgentImage(image).then(
      (value) => {
        if (alive) setUrl(value)
      },
      () => {
        if (alive) setUrl(null)
      }
    )
    return () => {
      alive = false
    }
  }, [image])

  return url
}

interface AgentImageThumbProps {
  image: AgentImageRef
  className?: string
}

export function AgentImageThumb({ image, className }: AgentImageThumbProps) {
  const url = useAgentImage(image)
  if (!url)
    return <span className={`w1-imgph${className ? ` ${className}` : ''}`} title={image.name} />
  return (
    <img
      className={className}
      src={url}
      alt={image.name}
      title={image.name}
      loading="lazy"
      decoding="async"
    />
  )
}
