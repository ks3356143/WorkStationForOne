import { useRef, useState } from 'react'
import { HOURS, MINUTE_STEPS, formatTime, parseTime } from '../../lib/pickers'
import { Popover } from './Popover'

interface TimePickerProps {
  id: string
  value: string
  label: string
  onChange: (value: string) => void
}

export function TimePicker({ id, value, label, onChange }: TimePickerProps) {
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [hour, setHour] = useState<number | null>(null)
  const [minute, setMinute] = useState<number | null>(null)

  const toggle = () => {
    // 打开时才把当前值灌进草稿：关掉未确认的选择不应该留在下一次
    if (!open) {
      const parsed = parseTime(value)
      setHour(parsed?.hour ?? null)
      setMinute(parsed?.minute ?? null)
    }
    setOpen((current) => !current)
  }

  const close = () => {
    setOpen(false)
    anchorRef.current?.focus()
  }

  const commit = () => {
    if (hour === null || minute === null) return
    onChange(formatTime(hour, minute))
    close()
  }

  const draft = hour === null ? '--:--' : formatTime(hour, minute ?? 0)

  return (
    <>
      <button
        ref={anchorRef}
        id={id}
        type="button"
        className={`w1-pick${value ? '' : ' empty'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}：${value || '未设置'}`}
        onClick={toggle}
      >
        <span className="w1-picktext w1-pickmono">{value || '未设置'}</span>
        <span className="w1-pickglyph" aria-hidden="true">
          ◷
        </span>
      </button>

      <Popover anchor={anchorRef.current} open={open} onClose={close} label={label} width={232}>
        <div className="w1-timehead">
          <span>{label}</span>
          <b className="w1-pickmono">{draft}</b>
        </div>

        <div className="w1-timecols">
          <div className="w1-timecol" role="listbox" aria-label="小时">
            {HOURS.map((item) => (
              <button
                key={item}
                type="button"
                role="option"
                aria-selected={hour === item}
                className={`w1-timeopt${hour === item ? ' on' : ''}`}
                onClick={() => setHour(item)}
              >
                {String(item).padStart(2, '0')}
              </button>
            ))}
          </div>
          <div className="w1-timecol" role="listbox" aria-label="分钟">
            {MINUTE_STEPS.map((item) => (
              <button
                key={item}
                type="button"
                role="option"
                aria-selected={minute === item}
                className={`w1-timeopt${minute === item ? ' on' : ''}`}
                onClick={() => setMinute(item)}
              >
                {String(item).padStart(2, '0')}
              </button>
            ))}
          </div>
        </div>

        <div className="w1-pickfoot">
          <button
            type="button"
            className="w1-pickquick"
            onClick={() => {
              onChange('')
              close()
            }}
          >
            清除
          </button>
          <button
            type="button"
            className="w1-pickquick pri"
            disabled={hour === null || minute === null}
            onClick={commit}
          >
            确定
          </button>
        </div>
      </Popover>
    </>
  )
}
