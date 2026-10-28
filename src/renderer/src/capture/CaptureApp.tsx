import { useEffect, useRef, useState } from 'react'
import { addDaysKey, dateKey } from '../../../shared/date-key'
import type { TaskDraft } from '../../../shared/ipc'
import { parseTaskInput } from '../lib/todo-parser'
import { HighlightedInput } from '../components/fields/HighlightedInput'

export function CaptureApp() {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const today = dateKey()
  const parsed = parseTaskInput(value, today)
  const dueDate = parsed.dueDate ?? (parsed.time ? today : undefined)
  const canAdd = parsed.title.length > 0 && !busy

  useEffect(() => {
    inputRef.current?.focus()
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      setBusy(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const close = () => {
    void window.ws?.capture?.close()
  }

  const submit = async () => {
    if (!canAdd) return
    setBusy(true)
    const draft: TaskDraft = {
      title: parsed.title,
      ...(dueDate ? { dueDate } : {}),
      ...(parsed.time ? { time: parsed.time } : {}),
      ...(parsed.priority ? { priority: parsed.priority } : {}),
      ...(parsed.list ? { list: parsed.list } : {})
    }
    try {
      await window.ws?.capture?.create(draft)
      setValue('')
      setBusy(false)
      close()
    } catch (error) {
      console.error('[capture] 写入失败', error)
      setBusy(false)
    }
  }

  return (
    // .w1 只提供设计令牌与极光底色；捕获页不复用应用外壳布局
    <div className="w1">
      <div className="cap">
        <div className="cap-head">
          <span>// 快速捕获</span>
          <span>
            <kbd>Esc</kbd> 关闭
          </span>
        </div>

        <div className="cap-row">
          <span className="cap-prompt" aria-hidden="true">
            &gt;
          </span>
          <HighlightedInput
            ref={inputRef}
            value={value}
            today={today}
            placeholder="明天 15:00 交周报 #工作"
            ariaLabel="快速捕获任务"
            className="cap-input"
            onChange={setValue}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                close()
              }
            }}
          />
        </div>

        <div className="cap-hint">
          {value ? (
            <>
              {dueDate ? (
                <span className="w1-todochip date">
                  {dueDate === today
                    ? '今天'
                    : dueDate === addDaysKey(today, 1)
                      ? '明天'
                      : dueDate.slice(5)}
                </span>
              ) : null}
              {parsed.time ? <span className="w1-todochip">{parsed.time}</span> : null}
              {parsed.priority ? <span className="w1-todochip pri">优先级</span> : null}
              {parsed.list ? <span className="w1-todochip list">#{parsed.list}</span> : null}
              <span className="sp" />
              <span>{canAdd ? 'Enter 添加' : '再写一个标题'}</span>
            </>
          ) : (
            <>
              <span>识别 今天 / 明天 / 周五 / 3天后、15:00 / 下午三点、!高、#清单</span>
              <span className="sp" />
              <span>Ctrl+Alt+Space 随时唤出</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
