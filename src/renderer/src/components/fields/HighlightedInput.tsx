import { forwardRef, useLayoutEffect, useRef, useState } from 'react'
import { tokenizeTaskInput, type TokenSpan } from '../../lib/todo-parser'

interface HighlightedInputProps {
  value: string
  today: string
  onChange: (value: string) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder: string
  ariaLabel: string
  maxLength?: number
  /** 应用到 input 本身，保留既有的 .w1-todoinput / .cap-input 选择器 */
  className?: string
}

const KIND_CLASS: Record<TokenSpan['kind'], string> = {
  date: 'w1-hlk-date',
  time: 'w1-hlk-time',
  priority: 'w1-hlk-priority',
  list: 'w1-hlk-list'
}

/**
 * 输入框内无法给子串上色，用镜像层画底色：
 * input 自己画字与光标，镜像只负责在相同位置铺 token 底纹。
 */
export const HighlightedInput = forwardRef<HTMLInputElement, HighlightedInputProps>(
  function HighlightedInput(
    { value, today, onChange, onKeyDown, placeholder, ariaLabel, maxLength = 500, className },
    ref
  ) {
    const mirrorRef = useRef<HTMLDivElement | null>(null)
    const innerRef = useRef<HTMLInputElement | null>(null)
    const [composing, setComposing] = useState(false)
    const [focused, setFocused] = useState(false)

    const spans = composing ? [] : tokenizeTaskInput(value, today).spans

    // 长标题会横向滚动，镜像必须跟着走，否则高亮会错位
    const syncScroll = () => {
      if (mirrorRef.current && innerRef.current) {
        mirrorRef.current.scrollLeft = innerRef.current.scrollLeft
      }
    }

    // biome-ignore lint/correctness/useExhaustiveDependencies: 正文只读 ref，value 是触发条件（内容变化后重新对齐滚动）
    useLayoutEffect(() => {
      if (mirrorRef.current && innerRef.current) {
        mirrorRef.current.scrollLeft = innerRef.current.scrollLeft
      }
    }, [value])

    const setRefs = (node: HTMLInputElement | null) => {
      innerRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    }

    // 片段带原文起始位置：位置本身就是稳定 key，比数组下标更贴合语义
    const segments: { at: number; text: string; kind?: TokenSpan['kind'] }[] = []
    let cursor = 0
    for (const span of spans) {
      if (span.start > cursor) segments.push({ at: cursor, text: value.slice(cursor, span.start) })
      segments.push({ at: span.start, text: value.slice(span.start, span.end), kind: span.kind })
      cursor = span.end
    }
    if (cursor < value.length) segments.push({ at: cursor, text: value.slice(cursor) })

    return (
      <div className={`w1-hlinput${focused ? ' on' : ''}`}>
        <div ref={mirrorRef} className="w1-hlmirror" aria-hidden="true">
          <span className="w1-hlline">
            {value ? (
              segments.map((segment) =>
                segment.kind ? (
                  <mark
                    key={`${segment.at}-${segment.kind}`}
                    className={`w1-hlk ${KIND_CLASS[segment.kind]}`}
                  >
                    {segment.text}
                  </mark>
                ) : (
                  <span key={segment.at}>{segment.text}</span>
                )
              )
            ) : (
              // 空值也要撑出一行，否则镜像层塌陷、刷新时底纹跳动
              <span>&#8203;</span>
            )}
          </span>
        </div>
        <input
          ref={setRefs}
          className={className}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoComplete="off"
          spellCheck={false}
          onScroll={syncScroll}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    )
  }
)
