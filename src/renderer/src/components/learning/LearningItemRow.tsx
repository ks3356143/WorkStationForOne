import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { addDaysKey } from '../../../../shared/date-key'
import type { LearningPatch } from '../../../../shared/ipc'
import type { LearningItem } from '../../types'
import { isDue, learningDueLabel } from '../../lib/learning'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { ComboSelect } from '../fields/ComboSelect'
import { DatePicker } from '../fields/DatePicker'

interface LearningItemRowProps {
  item: LearningItem
  today: string
  subjects: string[]
  expanded: boolean
  jump?: boolean
  onExpand: () => void
  onSave: (patch: LearningPatch) => void
  onDelete: () => void
  onCollapse: () => void
}

export function LearningItemRow({
  item,
  today,
  subjects,
  expanded,
  jump = false,
  onExpand,
  onSave,
  onDelete,
  onCollapse
}: LearningItemRowProps) {
  const [subject, setSubject] = useState(item.subject)
  const [title, setTitle] = useState(item.title)
  const [source, setSource] = useState(item.source ?? '')
  const [notes, setNotes] = useState(item.notes ?? '')
  const [nextReviewOn, setNextReviewOn] = useState(item.nextReviewOn)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const deleteTimer = useRef<number | null>(null)
  const due = isDue(item, today)
  const editorId = `learn-edit-${item.id}`

  useEffect(
    () => () => {
      if (deleteTimer.current) window.clearTimeout(deleteTimer.current)
    },
    []
  )

  const requestDelete = () => {
    if (confirmingDelete) {
      if (deleteTimer.current) window.clearTimeout(deleteTimer.current)
      setConfirmingDelete(false)
      onDelete()
      return
    }
    setConfirmingDelete(true)
    if (deleteTimer.current) window.clearTimeout(deleteTimer.current)
    deleteTimer.current = window.setTimeout(() => setConfirmingDelete(false), 4000)
  }

  const save = () => {
    if (!title.trim() || !subject.trim()) return
    onSave({
      subject: subject.trim(),
      title: title.trim(),
      source,
      notes,
      nextReviewOn
    })
  }

  return (
    <div
      id={`learn-item-${item.id}`}
      className={`w1-litem${item.active ? '' : ' off'}${expanded ? ' open' : ''}${jump ? ' jump' : ''}`}
    >
      <div className="w1-litemrow">
        <span className={`w1-ldot${due ? ' due' : ''}`} aria-hidden="true" />
        <button
          className="w1-lbody"
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? editorId : undefined}
          onClick={onExpand}
        >
          <span className="w1-ltitle">{item.title}</span>
          {item.kind === 'cloze' ? <span className="w1-lkind">挖空</span> : null}
          {item.source ? <span className="w1-lsource">{item.source}</span> : null}
          {item.subject ? <span className="w1-lsubject">{item.subject}</span> : null}
        </button>
        <span className={`w1-ldue${item.nextReviewOn < today ? ' overdue' : due ? ' today' : ''}`}>
          {learningDueLabel(item, today)}
        </span>
        <span className="w1-linterval">
          {item.stability === undefined && item.repetitions === 0
            ? '新卡'
            : item.intervalDays === 0
              ? '今天'
              : `${item.intervalDays} 天`}
        </span>
      </div>

      <AnimatePresence initial={false}>
        {expanded ? (
          <m.div
            key="editor"
            id={editorId}
            className="w1-leditorwrap"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DURATION.reveal, ease: EASE_OUT }}
          >
            <form
              className="w1-leditor"
              onSubmit={(event) => {
                event.preventDefault()
                save()
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  onCollapse()
                }
              }}
            >
              <div className="w1-leditmain">
                <div className="w1-todofield">
                  <label htmlFor={`learn-title-${item.id}`}>正面</label>
                  <input
                    id={`learn-title-${item.id}`}
                    value={title}
                    autoFocus
                    maxLength={200}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
                <div className="w1-todofield">
                  <label htmlFor={`learn-notes-${item.id}`}>背面</label>
                  <textarea
                    id={`learn-notes-${item.id}`}
                    value={notes}
                    maxLength={2000}
                    placeholder="释义、例句或解释…"
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </div>
              </div>

              <div className="w1-leditside">
                <div className="w1-todofield">
                  <span className="w1-todofieldlabel">科目</span>
                  <ComboSelect
                    id={`learn-subject-${item.id}`}
                    value={subject}
                    label="科目"
                    placeholder="英语二"
                    options={subjects}
                    maxLength={40}
                    onChange={setSubject}
                  />
                </div>
                <div className="w1-todofield">
                  <label htmlFor={`learn-source-${item.id}`}>来源</label>
                  <input
                    id={`learn-source-${item.id}`}
                    value={source}
                    maxLength={2000}
                    placeholder="真题年份 / 章节"
                    onChange={(event) => setSource(event.target.value)}
                  />
                </div>
                <div className="w1-todofield">
                  <span className="w1-todofieldlabel">下次复习</span>
                  <DatePicker
                    id={`learn-next-${item.id}`}
                    value={nextReviewOn}
                    today={today}
                    label="下次复习"
                    allowClear={false}
                    onChange={setNextReviewOn}
                  />
                  <div className="w1-tododatequick" role="group" aria-label="快捷复习日">
                    <button
                      type="button"
                      className={nextReviewOn === today ? 'on' : ''}
                      aria-pressed={nextReviewOn === today}
                      onClick={() => setNextReviewOn(today)}
                    >
                      今天
                    </button>
                    <button
                      type="button"
                      className={nextReviewOn === addDaysKey(today, 1) ? 'on' : ''}
                      aria-pressed={nextReviewOn === addDaysKey(today, 1)}
                      onClick={() => setNextReviewOn(addDaysKey(today, 1))}
                    >
                      明天
                    </button>
                  </div>
                </div>
              </div>

              <div className="w1-todoactions">
                <button
                  className="w1-todosave"
                  type="submit"
                  disabled={!title.trim() || !subject.trim()}
                >
                  保存
                </button>
                <button className="w1-todocancel" type="button" onClick={onCollapse}>
                  收起
                </button>
                <button
                  className="w1-todocancel"
                  type="button"
                  onClick={() => onSave({ active: !item.active })}
                >
                  {item.active ? '停用卡片' : '重新启用'}
                </button>
                <button
                  className={`w1-tododelete${confirmingDelete ? ' confirming' : ''}`}
                  type="button"
                  onClick={requestDelete}
                  onBlur={() => {
                    if (deleteTimer.current) window.clearTimeout(deleteTimer.current)
                    setConfirmingDelete(false)
                  }}
                >
                  {confirmingDelete ? '再次点击确认删除' : '删除卡片'}
                </button>
              </div>
            </form>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
