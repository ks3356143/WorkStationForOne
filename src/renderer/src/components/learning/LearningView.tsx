import { useEffect, useState } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { addDaysKey, dateKey } from '../../../../shared/date-key'
import type { LearningDraft, LearningPatch } from '../../../../shared/ipc'
import type { LearningItem } from '../../types'
import {
  estimatedMinutes,
  filterItems,
  isDue,
  learningSubjects,
  learningDueLabel
} from '../../lib/learning'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { useNow } from '../../lib/useNow'
import { useWorkstation } from '../../store/useWorkstation'
import { PlusIcon } from '../Glyphs'

interface LearningItemRowProps {
  item: LearningItem
  today: string
  subjects: string[]
  expanded: boolean
  onExpand: () => void
  onSave: (patch: LearningPatch) => void
  onCollapse: () => void
}

function LearningItemRow({
  item,
  today,
  subjects,
  expanded,
  onExpand,
  onSave,
  onCollapse
}: LearningItemRowProps) {
  const [subject, setSubject] = useState(item.subject)
  const [title, setTitle] = useState(item.title)
  const [source, setSource] = useState(item.source ?? '')
  const [notes, setNotes] = useState(item.notes ?? '')
  const [nextReviewOn, setNextReviewOn] = useState(item.nextReviewOn)
  const due = isDue(item, today)
  const editorId = `learn-edit-${item.id}`

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
    <div className={`w1-litem${item.active ? '' : ' off'}${expanded ? ' open' : ''}`}>
      <div className="w1-lrow">
        <span className={`w1-ldot${due ? ' due' : ''}`} aria-hidden="true" />
        <button
          className="w1-lbody"
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? editorId : undefined}
          onClick={onExpand}
        >
          <span className="w1-ltitle">{item.title}</span>
          {item.source ? <span className="w1-lsource">{item.source}</span> : null}
          {item.subject ? <span className="w1-lsubject">{item.subject}</span> : null}
        </button>
        <span className={`w1-ldue${item.nextReviewOn < today ? ' overdue' : due ? ' today' : ''}`}>
          {learningDueLabel(item, today)}
        </span>
        <span className="w1-linterval">
          {item.intervalDays === 0 ? '新卡' : `${item.intervalDays} 天`}
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
                  <label htmlFor={`learn-subject-${item.id}`}>科目</label>
                  <input
                    id={`learn-subject-${item.id}`}
                    list="w1-learnsubjects"
                    value={subject}
                    maxLength={40}
                    onChange={(event) => setSubject(event.target.value)}
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
                  <label htmlFor={`learn-next-${item.id}`}>下次复习</label>
                  <input
                    id={`learn-next-${item.id}`}
                    type="date"
                    value={nextReviewOn}
                    onChange={(event) => setNextReviewOn(event.target.value)}
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
                <datalist id="w1-learnsubjects">
                  {subjects.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
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
                  className="w1-tododelete"
                  type="button"
                  onClick={() => onSave({ active: !item.active })}
                >
                  {item.active ? '停用卡片' : '重新启用'}
                </button>
              </div>
            </form>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

interface NewCardFormProps {
  subjects: string[]
  today: string
  onSubmit: (draft: LearningDraft) => void
  onCancel: () => void
}

function NewCardForm({ subjects, today, onSubmit, onCancel }: NewCardFormProps) {
  const [subject, setSubject] = useState(subjects[0] ?? '英语二')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')

  const submit = () => {
    if (!title.trim() || !subject.trim()) return
    onSubmit({ subject: subject.trim(), title: title.trim(), notes, nextReviewOn: today })
  }

  return (
    <form
      className="w1-lnew"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Escape') {
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      <div className="w1-lnewrow">
        <div className="w1-todofield">
          <label htmlFor="learn-new-subject">科目</label>
          <input
            id="learn-new-subject"
            list="w1-learnsubjects"
            value={subject}
            maxLength={40}
            onChange={(event) => setSubject(event.target.value)}
          />
        </div>
        <div className="w1-todofield">
          <label htmlFor="learn-new-title">正面</label>
          <input
            id="learn-new-title"
            value={title}
            autoFocus
            maxLength={200}
            placeholder="单词或概念"
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
      </div>
      <div className="w1-todofield">
        <label htmlFor="learn-new-notes">背面</label>
        <textarea
          id="learn-new-notes"
          value={notes}
          maxLength={2000}
          placeholder="释义、例句或解释…"
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
      <div className="w1-todoactions">
        <button className="w1-todosave" type="submit" disabled={!title.trim() || !subject.trim()}>
          保存卡片
        </button>
        <button className="w1-todocancel" type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  )
}

interface LearningLibraryProps {
  onStartReview: () => void
}

export function LearningLibrary({ onStartReview }: LearningLibraryProps) {
  const items = useWorkstation((state) => state.learningItems)
  const scope = useWorkstation((state) => state.learningScope)
  const setScope = useWorkstation((state) => state.setLearningScope)
  const addItem = useWorkstation((state) => state.addLearningItem)
  const updateItem = useWorkstation((state) => state.updateLearningItem)
  const now = useNow(60_000)
  const today = dateKey(now)
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const active = items.filter((item) => item.active)
  const dueCount = active.filter((item) => item.nextReviewOn <= today).length
  const inactiveCount = items.length - active.length
  const subjectDue = learningSubjects(items)
  const subjects = subjectDue.map((entry) => entry.subject)
  const subjectCounts = new Map(subjectDue.map((entry) => [entry.subject, entry.count]))
  const visible = filterItems(items, scope, query)
  const searching = query.trim().length > 0

  // biome-ignore lint/correctness/useExhaustiveDependencies: scope/query 变化时收起展开项
  useEffect(() => {
    setExpandedId(null)
  }, [scope, query])

  const title =
    scope.kind === 'inactive' ? '已停用' : scope.kind === 'subject' ? scope.subject : '全部卡片'

  return (
    <section className="w1-workspace w1-learn" aria-label="学习工作区">
      <aside className="w1-todorail w1-learnrail" aria-label="科目">
        <div className="w1-todorailhead">
          <span className="w1-eyebrow">// 科目</span>
          <button
            className="w1-todonew"
            type="button"
            onClick={() => {
              setQuery('')
              setCreating(true)
            }}
          >
            <PlusIcon width={10} height={10} />
            新建
          </button>
        </div>

        <div className="w1-todonav" role="group" aria-label="卡片范围">
          <button
            type="button"
            className={`w1-todorow${scope.kind === 'all' ? ' on' : ''}`}
            aria-pressed={scope.kind === 'all'}
            onClick={() => {
              setQuery('')
              setScope({ kind: 'all' })
            }}
          >
            <span className="w1-todokey">01</span>
            <span className="w1-todolabel">全部</span>
            <span className="w1-todocount">{active.length}</span>
          </button>

          {subjects.map((subject, index) => {
            const current = scope.kind === 'subject' && scope.subject === subject
            const count = subjectCounts.get(subject) ?? 0
            return (
              <button
                key={subject}
                type="button"
                className={`w1-todorow${current ? ' on' : ''}`}
                aria-pressed={current}
                onClick={() => {
                  setQuery('')
                  setScope({ kind: 'subject', subject })
                }}
              >
                <span className="w1-todokey">{String(index + 2).padStart(2, '0')}</span>
                <span className="w1-todolabel">{subject}</span>
                <span className="w1-todocount">{count}</span>
              </button>
            )
          })}

          <button
            type="button"
            className={`w1-todorow${scope.kind === 'inactive' ? ' on' : ''}`}
            aria-pressed={scope.kind === 'inactive'}
            onClick={() => {
              setQuery('')
              setScope({ kind: 'inactive' })
            }}
          >
            <span className="w1-todokey">—</span>
            <span className="w1-todolabel">已停用</span>
            <span className="w1-todocount">{inactiveCount}</span>
          </button>
        </div>

        <div className="w1-todorailfoot">
          <kbd>{dueCount}</kbd>
          <span>{dueCount > 0 ? '张今天到期' : '今天没有到期'}</span>
        </div>
      </aside>

      <div className="w1-todomain w1-learnmain">
        <header className="w1-todohead">
          <div>
            <div className="w1-date">
              <i>//</i> 学习
            </div>
            <h1 className="w1-todotitle">
              {title}
              <span>.</span>
            </h1>
            <div className="w1-todosub">
              {searching ? (
                <>
                  搜索 <b>{visible.length}</b> 张
                </>
              ) : (
                <>
                  <span className="w1-subtag">到期</span>
                  <b>{dueCount}</b> 张 · 本轮约 <b>{estimatedMinutes(dueCount)}</b> 分钟
                </>
              )}
            </div>
          </div>

          <div className="w1-learnacts">
            <button className="w1-lrevbtn" type="button" onClick={onStartReview}>
              开始复习{' '}
              <span>{dueCount > 0 ? `约 ${estimatedMinutes(dueCount)} 分钟` : '今天已清空'}</span>
            </button>
            <div className="w1-todosearch">
              <span aria-hidden="true">&gt;</span>
              <input
                value={query}
                placeholder="搜索正面、来源与背面…"
                aria-label="搜索卡片"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return
                  if (event.key === 'Escape' && query) {
                    event.preventDefault()
                    setQuery('')
                  }
                }}
              />
              {query ? (
                <button type="button" onClick={() => setQuery('')} aria-label="清空卡片搜索">
                  清空
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="w1-todoscroll w1-learnscroll">
          {creating ? (
            <NewCardForm
              subjects={subjects.length > 0 ? subjects : ['英语二', '互联网']}
              today={today}
              onSubmit={(draft) => {
                addItem(draft)
                setCreating(false)
              }}
              onCancel={() => setCreating(false)}
            />
          ) : null}

          <div role="list" aria-label={title}>
            {visible.map((item) => (
              <LearningItemRow
                key={item.id}
                item={item}
                today={today}
                subjects={subjects}
                expanded={expandedId === item.id}
                onExpand={() => setExpandedId((current) => (current === item.id ? null : item.id))}
                onSave={(patch) => {
                  updateItem(item.id, patch)
                  setExpandedId(null)
                }}
                onCollapse={() => setExpandedId(null)}
              />
            ))}
          </div>

          {visible.length === 0 && !creating ? (
            <div className="w1-todoempty">
              <b>
                {searching
                  ? '没有匹配的卡片。'
                  : scope.kind === 'inactive'
                    ? '没有停用的卡片。'
                    : '先建一张卡，明天就能开始复习。'}
              </b>
              <span>
                {searching ? '换个关键词，或清空搜索。' : '点左上角「新建」写下第一张卡。'}
              </span>
            </div>
          ) : (
            <div className="w1-todoend">
              <span>// END</span>
              <b>
                {visible.length} 张{dueCount > 0 ? ` · ${dueCount} 张今天到期` : ''}
              </b>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
