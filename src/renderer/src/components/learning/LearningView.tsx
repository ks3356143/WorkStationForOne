import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { clozeFrontText, validateCloze } from '../../../../shared/cloze'
import { addDaysKey, dateKey } from '../../../../shared/date-key'
import {
  LEARNING_LIMITS,
  parseLearningCsv,
  type LearningCsvError,
  type LearningCsvRow
} from '../../../../shared/learning-csv'
import { MEM_SUBJECTS } from '../../../../shared/mem-starters'
import type { LearningDraft, LearningPatch } from '../../../../shared/ipc'
import type { LearningItem } from '../../types'
import {
  estimatedMinutes,
  filterItems,
  isDue,
  learningSubjects,
  learningDueLabel
} from '../../lib/learning'
import { planImport } from '../../lib/learning-import'
import { learningStats } from '../../lib/learning-stats'
import { replaceLearning } from '../../lib/learning-persistence'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { useNow } from '../../lib/useNow'
import { useWorkstation } from '../../store/useWorkstation'
import { ComboSelect } from '../fields/ComboSelect'
import { DatePicker } from '../fields/DatePicker'
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
  const [kind, setKind] = useState<'basic' | 'cloze'>('basic')
  const [clozeSource, setClozeSource] = useState('')
  const clozeError = kind === 'cloze' ? validateCloze(clozeSource) : null
  const ready = kind === 'cloze' ? !clozeError : Boolean(title.trim())

  const submit = () => {
    if (!subject.trim() || !ready) return
    if (kind === 'cloze') {
      onSubmit({
        subject: subject.trim(),
        title: clozeFrontText(clozeSource).slice(0, 200),
        kind: 'cloze',
        clozeSource,
        nextReviewOn: today
      })
      return
    }
    if (!title.trim()) return
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
          <span className="w1-todofieldlabel">科目</span>
          <ComboSelect
            id="learn-new-subject"
            value={subject}
            label="科目"
            placeholder="英语二"
            options={subjects}
            maxLength={40}
            onChange={setSubject}
          />
        </div>
        <div className="w1-todofield">
          <span className="w1-todofieldlabel">卡型</span>
          <div className="w1-lkindtabs" role="group" aria-label="卡片类型">
            <button
              type="button"
              className={kind === 'basic' ? 'on' : ''}
              aria-pressed={kind === 'basic'}
              onClick={() => setKind('basic')}
            >
              问答
            </button>
            <button
              type="button"
              className={kind === 'cloze' ? 'on' : ''}
              aria-pressed={kind === 'cloze'}
              onClick={() => setKind('cloze')}
            >
              挖空
            </button>
          </div>
        </div>
      </div>

      {kind === 'cloze' ? (
        <div className="w1-todofield">
          <label htmlFor="learn-new-cloze">挖空原文</label>
          <textarea
            id="learn-new-cloze"
            value={clozeSource}
            autoFocus
            maxLength={2000}
            placeholder="特征值的三条性质：{{c1::和、积、特征多项式}}"
            onChange={(event) => setClozeSource(event.target.value)}
          />
          <span className={`w1-lclozehint${clozeError ? ' bad' : ''}`}>
            {clozeError ??
              (clozeSource
                ? `正面预览：${clozeFrontText(clozeSource)}`
                : '用 {{c1::答案}} 标记要隐藏的部分')}
          </span>
        </div>
      ) : (
        <>
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
        </>
      )}

      <div className="w1-todoactions">
        <button className="w1-todosave" type="submit" disabled={!subject.trim() || !ready}>
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
  const api = typeof window === 'undefined' ? undefined : window.ws?.learning
  const fileRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [statsOpen, setStatsOpen] = useState(false)
  const [preview, setPreview] = useState<{
    fileName: string
    rows: LearningCsvRow[]
    errors: LearningCsvError[]
    duplicates: number
  } | null>(null)

  const active = items.filter((item) => item.active)
  const dueCount = active.filter((item) => item.nextReviewOn <= today).length
  const inactiveCount = items.length - active.length
  const subjectDue = learningSubjects(items)
  const subjects = subjectDue.map((entry) => entry.subject)
  // MEM 四项始终排在前面，现有科目（含历史互联网卡）继续保留、可继续选。
  const subjectOptions = [...new Set([...MEM_SUBJECTS, ...subjects])]
  const subjectCounts = new Map(subjectDue.map((entry) => [entry.subject, entry.count]))
  const visible = filterItems(items, scope, query)
  const searching = query.trim().length > 0

  // biome-ignore lint/correctness/useExhaustiveDependencies: scope/query 变化时收起展开项
  useEffect(() => {
    setExpandedId(null)
  }, [scope, query])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!preview) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [preview])

  useEffect(() => {
    if (!statsOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setStatsOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [statsOpen])

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > LEARNING_LIMITS.maxBytes) {
      setNotice(`文件超过 ${LEARNING_LIMITS.maxBytes / 1024 / 1024}MB`)
      return
    }
    try {
      const parsed = parseLearningCsv(await file.text())
      const plan = planImport(parsed.rows, items)
      setPreview({
        fileName: file.name,
        rows: plan.rows,
        errors: parsed.errors,
        duplicates: plan.duplicates
      })
    } catch (error) {
      console.error('[learning] 读取 CSV 失败', error)
      setNotice('读取 CSV 失败')
    }
  }

  const confirmImport = async () => {
    if (!preview || !api) return
    try {
      const result = await api.createMany(preview.rows.map((row) => row.draft))
      replaceLearning(await api.list())
      const duplicates = preview.duplicates + result.skipped
      const errors = preview.errors.length + result.errors.length
      setNotice(
        [
          `已导入 ${result.created.length} 张`,
          duplicates > 0 ? `跳过重复 ${duplicates}` : '',
          errors > 0 ? `跳过错误 ${errors}` : ''
        ]
          .filter(Boolean)
          .join(' · ')
      )
      setPreview(null)
    } catch (error) {
      console.error('[learning] 导入失败', error)
      setNotice('导入失败，未写入任何卡片')
    }
  }

  const exportCards = async () => {
    if (!api) return
    const subject = scope.kind === 'subject' ? scope.subject : undefined
    try {
      const result = await api.exportCards(subject)
      if (result.canceled) return
      if (!result.count) {
        setNotice('没有可导出的卡片')
        return
      }
      const name = result.path?.split(/[\\/]/).pop() ?? 'CSV'
      setNotice(`已导出 ${result.count} 张 · ${name}`)
    } catch (error) {
      console.error('[learning] 导出失败', error)
      setNotice('导出失败')
    }
  }

  const title =
    scope.kind === 'inactive' ? '已停用' : scope.kind === 'subject' ? scope.subject : '全部卡片'

  const stats = learningStats(items, today)
  const peak = Math.max(1, ...stats.forecast.map((day) => day.count))
  const masteryTotal = stats.mastery.fresh + stats.mastery.learning + stats.mastery.mature
  const share = (count: number) => (masteryTotal > 0 ? `${(count / masteryTotal) * 100}%` : '0%')
  const retentionLabel = stats.retention === null ? '—' : `${Math.round(stats.retention * 100)}%`

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
            <div className="w1-learnactionrow">
              <button className="w1-lrevbtn" type="button" onClick={onStartReview}>
                开始复习{' '}
                <span>{dueCount > 0 ? `约 ${estimatedMinutes(dueCount)} 分钟` : '今天已清空'}</span>
              </button>
              <button
                className="w1-lfilebtn"
                type="button"
                title="查看未来 7 天负载与记忆保持率"
                onClick={() => setStatsOpen(true)}
              >
                统计
              </button>
              <input
                ref={fileRef}
                id="learn-import-file"
                className="w1-limportfile"
                type="file"
                accept=".csv,text/csv"
                aria-label="选择 CSV 文件"
                onChange={pickFile}
              />
              <button
                className="w1-lfilebtn"
                type="button"
                disabled={!api}
                title="从 CSV 导入卡片"
                onClick={() => fileRef.current?.click()}
              >
                导入
              </button>
              <button
                className="w1-lfilebtn"
                type="button"
                disabled={!api}
                title="把当前科目导出为 CSV"
                onClick={() => void exportCards()}
              >
                导出
              </button>
            </div>
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

        {notice ? <div className="w1-lnotice">{notice}</div> : null}

        <div className="w1-todoscroll w1-learnscroll">
          {creating ? (
            <NewCardForm
              subjects={subjectOptions}
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
                subjects={subjectOptions}
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

      {preview ? (
        <m.div
          className="w1-modalbackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreview(null)
          }}
        >
          <m.div
            className="w1-modal w1-limport"
            role="dialog"
            aria-modal="true"
            aria-label="导入学习卡片"
            tabIndex={-1}
            initial={{ opacity: 0, transform: 'translateY(12px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            transition={{ duration: DURATION.modal, ease: EASE_OUT }}
          >
            <div className="w1-modalhead">
              <span className="w1-eyebrow">// 导入 · {preview.fileName}</span>
              <button
                className="w1-modalx"
                type="button"
                aria-label="关闭"
                onClick={() => setPreview(null)}
              >
                ×
              </button>
            </div>
            <div className="w1-modaltitle">导入学习卡片。</div>
            <div className="w1-limportstats">
              <span>
                可导入 <b>{preview.rows.length}</b> 张
              </span>
              <span>
                重复 <b>{preview.duplicates}</b>
              </span>
              <span className={preview.errors.length > 0 ? 'bad' : ''}>
                错误 <b>{preview.errors.length}</b>
              </span>
            </div>
            <div className="w1-limportlist">
              {preview.rows.slice(0, 8).map((row) => (
                <div
                  key={`${row.line}-${row.draft.subject}-${row.draft.title}`}
                  className="w1-limportrow"
                >
                  <span>{row.draft.subject}</span>
                  <b>{row.draft.title}</b>
                  {row.draft.kind === 'cloze' ? <em>挖空</em> : null}
                </div>
              ))}
              {preview.errors.slice(0, 5).map((error) => (
                <div key={`${error.line}-${error.message}`} className="w1-limporterr">
                  第 {error.line} 行：{error.message}
                </div>
              ))}
            </div>
            <p className="w1-limportnote">
              导入的卡片都是新卡、今天到期；重复与错误行会跳过，不覆盖已有卡片。
            </p>
            <div className="w1-modalacts">
              <button className="w1-pb" type="button" onClick={() => setPreview(null)}>
                取消
              </button>
              <button
                className="w1-pb pri"
                type="button"
                disabled={preview.rows.length === 0}
                onClick={() => void confirmImport()}
              >
                导入 {preview.rows.length} 张
              </button>
            </div>
          </m.div>
        </m.div>
      ) : null}

      {statsOpen ? (
        <m.div
          className="w1-modalbackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setStatsOpen(false)
          }}
        >
          <m.div
            className="w1-modal w1-lstats"
            role="dialog"
            aria-modal="true"
            aria-label="学习统计"
            tabIndex={-1}
            initial={{ opacity: 0, transform: 'translateY(12px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            transition={{ duration: DURATION.modal, ease: EASE_OUT }}
          >
            <div className="w1-modalhead">
              <span className="w1-eyebrow">// 学习统计</span>
              <button
                className="w1-modalx"
                type="button"
                aria-label="关闭"
                onClick={() => setStatsOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="w1-modaltitle">记忆与负载。</div>

            <div className="w1-lstatgrid">
              <div>
                <span>今天到期</span>
                <b>{stats.forecast[0].count}</b>
                <small>约 {stats.forecast[0].minutes} 分钟</small>
              </div>
              <div>
                <span>记忆保持率</span>
                <b>{retentionLabel}</b>
                <small>
                  {stats.reviewed > 0 ? `${stats.reviewed} 张可估算` : '复习后开始估算'}
                </small>
              </div>
              <div>
                <span>成熟卡</span>
                <b>{stats.mastery.mature}</b>
                <small>稳定度 ≥ 21 天</small>
              </div>
            </div>

            <div className="w1-lstatblock">
              <span className="w1-lstatlabel">// 未来 7 天到期</span>
              <div
                className="w1-lstatforcast"
                role="img"
                aria-label={`未来 7 天到期：${stats.forecast
                  .map((day) => `${day.label} ${day.count} 张`)
                  .join('，')}`}
              >
                {stats.forecast.map((day) => (
                  <div className="w1-lstatday" key={day.day}>
                    <span className="w1-lstatbar" aria-hidden="true">
                      <i
                        style={{
                          height:
                            day.count === 0 ? '2px' : `${Math.max(10, (day.count / peak) * 100)}%`
                        }}
                      />
                    </span>
                    <b>{day.count}</b>
                    <small>{day.label}</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="w1-lstatblock">
              <span className="w1-lstatlabel">// 掌握分布</span>
              <div className="w1-lstatstack" aria-hidden="true">
                <i className="fresh" style={{ width: share(stats.mastery.fresh) }} />
                <i className="learning" style={{ width: share(stats.mastery.learning) }} />
                <i className="mature" style={{ width: share(stats.mastery.mature) }} />
              </div>
              <div className="w1-lstatlegend">
                <span>
                  <i className="fresh" />
                  新卡 {stats.mastery.fresh}
                </span>
                <span>
                  <i className="learning" />
                  学习中 {stats.mastery.learning}
                </span>
                <span>
                  <i className="mature" />
                  成熟 {stats.mastery.mature}
                </span>
              </div>
            </div>

            <p className="w1-lstatnote">
              保持率按 FSRS 稳定度估算，未复习的新卡不计入；未来 7 天按当前排期统计。
            </p>
            <div className="w1-modalacts">
              <button className="w1-pb" type="button" onClick={() => setStatsOpen(false)}>
                关闭
              </button>
            </div>
          </m.div>
        </m.div>
      ) : null}
    </section>
  )
}
