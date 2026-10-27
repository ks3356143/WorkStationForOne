import { useMemo, useRef, useState } from 'react'
import { Popover } from './Popover'

interface ComboSelectProps {
  id: string
  value: string
  label: string
  placeholder: string
  options: string[]
  maxLength?: number
  emptyLabel?: string
  onChange: (value: string) => void
}

/** 可输入可选的单行字段：保留自由输入（新建清单/科目），下拉只做建议。 */
export function ComboSelect({
  id,
  value,
  label,
  placeholder,
  options,
  maxLength = 80,
  emptyLabel,
  onChange
}: ComboSelectProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [activeKey, setActiveKey] = useState<{ key: string; index: number } | null>(null)

  const query = value.trim().toLowerCase()
  const matches = useMemo(() => {
    const pool = emptyLabel ? ['', ...options] : options
    const filtered = query ? pool.filter((item) => item.toLowerCase().includes(query)) : pool
    return filtered.slice(0, 8)
  }, [emptyLabel, options, query])

  // 高亮跟着「查询词 + 开关」重置：用键控状态代替 effect，避免多余依赖告警
  const activeSeq = `${open ? 1 : 0}|${query}`
  const active = activeKey?.key === activeSeq ? activeKey.index : 0
  const setActive = (next: number) => setActiveKey({ key: activeSeq, index: next })

  const commit = (next: string) => {
    onChange(next)
    setOpen(false)
    inputRef.current?.focus()
  }

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
            setActive((active + 1) % Math.max(1, matches.length))
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
            setActive((active - 1 + matches.length) % Math.max(1, matches.length))
            return
          }
          if (event.key === 'Enter' && open && matches.length > 0) {
            event.preventDefault()
            commit(matches[active] ?? value)
            return
          }
          if (event.key === 'Escape' && open) {
            event.stopPropagation()
            setOpen(false)
          }
        }}
      />

      <Popover
        anchor={inputRef.current}
        open={open && matches.length > 0}
        onClose={() => setOpen(false)}
        label={label}
        width={Math.max(200, inputRef.current?.offsetWidth ?? 200)}
      >
        <div className="w1-picklist" id={`${id}-list`} role="listbox" aria-label={label}>
          {matches.map((item, index) => (
            <button
              key={item || '__empty'}
              type="button"
              role="option"
              aria-selected={item === value}
              className={`w1-pickoption${index === active ? ' hot' : ''}${
                item === value ? ' on' : ''
              }`}
              onPointerEnter={() => setActive(index)}
              onClick={() => commit(item)}
            >
              <span>{item || emptyLabel}</span>
              {item === value ? <i aria-hidden="true">●</i> : null}
            </button>
          ))}
        </div>
      </Popover>
    </>
  )
}
