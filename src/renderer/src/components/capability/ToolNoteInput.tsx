import { useEffect, useRef, useState } from 'react'
import { MAX_TOOL_NOTE } from '../../../../shared/tool-surface'

/** 首选行的用途说明：Enter / 失焦保存，Esc 撤销；空值表示清空。 */
export function ToolNoteInput({
  value,
  disabled,
  onSave
}: {
  value: string
  disabled: boolean
  onSave: (note: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const cancel = useRef(false)
  const [count, setCount] = useState(value.length)

  useEffect(() => {
    if (inputRef.current) inputRef.current.value = value
    setCount(value.length)
  }, [value])

  return (
    <div className="w1-capnoteedit">
      <span>用途</span>
      <input
        ref={inputRef}
        type="text"
        defaultValue={value}
        maxLength={MAX_TOOL_NOTE}
        disabled={disabled}
        placeholder="何时优先用它？例如：桌面窗口截图、浏览器操作（可留空）"
        aria-label="首选用途说明"
        onChange={(event) => setCount(event.target.value.length)}
        onBlur={() => {
          if (cancel.current) {
            cancel.current = false
            if (inputRef.current) inputRef.current.value = value
            setCount(value.length)
            return
          }
          const next = inputRef.current?.value.trim() ?? ''
          if (next !== value) onSave(next)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            event.stopPropagation()
            cancel.current = true
            event.currentTarget.blur()
          }
        }}
      />
      <small>
        {count}/{MAX_TOOL_NOTE}
      </small>
    </div>
  )
}
