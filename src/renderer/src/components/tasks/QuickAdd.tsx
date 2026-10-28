import { useEffect, useRef, useState } from 'react'
import { addDaysKey } from '../../../../shared/date-key'
import type { TaskDraft, TaskPriority } from '../../../../shared/ipc'
import type { TaskScope } from '../../types'
import { parseTaskInput } from '../../lib/todo-parser'
import { HighlightedInput } from '../fields/HighlightedInput'
import { PlusIcon } from '../Glyphs'

const PRIORITY_LABEL: Record<Exclude<TaskPriority, 0>, string> = { 1: '高', 2: '中', 3: '低' }

function dateChip(date: string, today: string): string {
  if (date === today) return '今天'
  if (date === addDaysKey(today, 1)) return '明天'
  return date.slice(5)
}

interface QuickAddProps {
  scope: TaskScope
  today: string
  focusSignal: number
  onAdd: (draft: TaskDraft) => void
}

export function QuickAdd({ scope, today, focusSignal, onAdd }: QuickAddProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const parsed = parseTaskInput(value, today)

  const defaultList = scope.startsWith('list:') ? scope.slice('list:'.length) : undefined
  const defaultDate =
    scope === 'today' ? today : scope === 'upcoming' ? addDaysKey(today, 1) : undefined
  const dueDate = parsed.dueDate ?? (parsed.time ? today : defaultDate)
  const list = parsed.list ?? defaultList
  const listTooLong = (list?.length ?? 0) > 80
  const canAdd = parsed.title.length > 0 && !listTooLong

  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus()
  }, [focusSignal])

  const submit = () => {
    if (!canAdd) return
    onAdd({
      title: parsed.title,
      ...(dueDate ? { dueDate } : {}),
      ...(parsed.time ? { time: parsed.time } : {}),
      ...(parsed.priority ? { priority: parsed.priority } : {}),
      ...(list ? { list } : {})
    })
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <div className="w1-todoquick">
      <div className="w1-todoquickrow">
        <span className="w1-todoquickprompt" aria-hidden="true">
          &gt;
        </span>
        <HighlightedInput
          ref={inputRef}
          value={value}
          today={today}
          placeholder="添加任务，试试「明天 15:00 提交周报 !高 #工作」"
          ariaLabel="快速添加任务"
          className="w1-todoinput"
          onChange={setValue}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            } else if (event.key === 'Escape' && value) {
              event.preventDefault()
              setValue('')
            }
          }}
        />
        <button className="w1-todoadd" type="button" onClick={submit} disabled={!canAdd}>
          <PlusIcon width={10} height={10} />
          添加
        </button>
      </div>

      <div className="w1-todoquickhint">
        {value ? (
          <>
            {dueDate ? <span className="w1-todochip date">{dateChip(dueDate, today)}</span> : null}
            {parsed.time ? <span className="w1-todochip">{parsed.time}</span> : null}
            {parsed.priority ? (
              <span className={`w1-todochip pri p${parsed.priority}`}>
                {PRIORITY_LABEL[parsed.priority]}
              </span>
            ) : null}
            {list ? <span className="w1-todochip list">#{list}</span> : null}
            {listTooLong ? (
              <span>清单名最多 80 字</span>
            ) : canAdd ? (
              <span className="w1-todopreview">按 Enter 添加</span>
            ) : (
              <span>再写一个标题</span>
            )}
          </>
        ) : (
          <span>
            识别 今天 / 明天 / 周五 / 3天后 / 10月30日、15:00 / 下午三点、!高 / !中 / !低、#清单
          </span>
        )}
      </div>
    </div>
  )
}
