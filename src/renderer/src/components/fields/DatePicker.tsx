import { useMemo, useRef, useState } from 'react'
import { addDaysKey } from '../../../../shared/date-key'
import {
  WEEKDAYS,
  formatDateLabel,
  formatLongDate,
  formatMonthTitle,
  monthGrid,
  nextMonday,
  parseMonth,
  shiftMonth
} from '../../lib/pickers'
import { Popover } from './Popover'

interface DatePickerProps {
  id: string
  value: string
  today: string
  label: string
  onChange: (value: string) => void
  allowClear?: boolean
}

export function DatePicker({
  id,
  value,
  today,
  label,
  onChange,
  allowClear = true
}: DatePickerProps) {
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => parseMonth(value || today))

  const toggle = () => {
    // 打开时回到当前值所在月份，避免上次翻页残留
    if (!open) setView(parseMonth(value || today))
    setOpen((current) => !current)
  }

  const grid = useMemo(() => monthGrid(view), [view])
  const cells = grid.map((cell) => ({
    ...cell,
    isToday: cell.key === today,
    selected: cell.key === value
  }))

  const pick = (key: string) => {
    onChange(key)
    setOpen(false)
    anchorRef.current?.focus()
  }

  return (
    <>
      <button
        ref={anchorRef}
        id={id}
        type="button"
        className={`w1-pick${value ? '' : ' empty'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}：${value ? formatLongDate(value) : '未设置'}`}
        onClick={toggle}
      >
        <span className="w1-picktext">{value ? formatDateLabel(value, today) : '未设置'}</span>
        <span className="w1-pickglyph" aria-hidden="true">
          ▦
        </span>
      </button>

      <Popover
        anchor={anchorRef.current}
        open={open}
        onClose={() => setOpen(false)}
        label={label}
        width={286}
      >
        <div className="w1-pickhead">
          <button
            type="button"
            className="w1-picknav"
            aria-label="上个月"
            onClick={() => setView((current) => shiftMonth(current.year, current.month, -1))}
          >
            ‹
          </button>
          <b className="w1-picktitle">{formatMonthTitle(view)}</b>
          <button
            type="button"
            className="w1-picknav"
            aria-label="下个月"
            onClick={() => setView((current) => shiftMonth(current.year, current.month, 1))}
          >
            ›
          </button>
        </div>

        <div className="w1-pickweek" aria-hidden="true">
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>

        <div className="w1-pickgrid" role="grid" aria-label={`${formatMonthTitle(view)}`}>
          {cells.map((cell, index) => (
            <button
              key={cell.key}
              type="button"
              className={`w1-pickday${cell.inMonth ? '' : ' out'}${
                cell.isToday ? ' today' : ''
              }${cell.selected ? ' on' : ''}${index % 7 >= 5 ? ' we' : ''}`}
              aria-pressed={cell.selected}
              aria-label={`${formatLongDate(cell.key)}`}
              onClick={() => pick(cell.key)}
            >
              {cell.day}
            </button>
          ))}
        </div>

        <div className="w1-pickfoot">
          <button type="button" className="w1-pickquick" onClick={() => pick(addDaysKey(today, 1))}>
            明天
          </button>
          <button type="button" className="w1-pickquick" onClick={() => pick(nextMonday(today))}>
            下周一
          </button>
          <button type="button" className="w1-pickquick pri" onClick={() => pick(today)}>
            今天
          </button>
          {allowClear && value ? (
            <button
              type="button"
              className="w1-pickclear"
              onClick={() => {
                onChange('')
                setOpen(false)
                anchorRef.current?.focus()
              }}
            >
              清除
            </button>
          ) : null}
        </div>
      </Popover>
    </>
  )
}
