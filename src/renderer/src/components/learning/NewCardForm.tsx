import { useState } from 'react'
import { clozeFrontText, validateCloze } from '../../../../shared/cloze'
import type { LearningDraft } from '../../../../shared/ipc'
import { ComboSelect } from '../fields/ComboSelect'

interface NewCardFormProps {
  subjects: string[]
  today: string
  onSubmit: (draft: LearningDraft) => void
  onCancel: () => void
}

export function NewCardForm({ subjects, today, onSubmit, onCancel }: NewCardFormProps) {
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
