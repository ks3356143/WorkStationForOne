import { useEffect, useMemo, useState } from 'react'
import { m } from 'motion/react'
import { DURATION, EASE_OUT } from '../../lib/motion'
import type { AgentQuestionRequest } from '../../../../shared/agent-stream'

interface QuestionCardProps {
  request: AgentQuestionRequest
  onResolve: (answers: Record<string, string> | null) => void
}

export function QuestionCard({ request, onResolve }: QuestionCardProps) {
  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const [otherOn, setOtherOn] = useState<Record<number, boolean>>({})
  const [otherText, setOtherText] = useState<Record<number, string>>({})
  const [preview, setPreview] = useState<{ index: number; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // 新问题到达时 reset；与 ToolApprovalCard 一样，key 不变时也要解锁按钮
  // biome-ignore lint/correctness/useExhaustiveDependencies: request 只作身份触发
  useEffect(() => {
    setSelected({})
    setOtherOn({})
    setOtherText({})
    setPreview(null)
    setBusy(false)
  }, [request])

  const answers = useMemo(() => {
    const result: Record<string, string> = {}
    request.questions.forEach((question, index) => {
      const values = [...(selected[index] ?? [])]
      if (otherOn[index] && otherText[index]?.trim()) values.push(otherText[index].trim())
      if (values.length > 0) result[question.question] = values.join(', ')
    })
    return result
  }, [request.questions, selected, otherOn, otherText])

  const ready = request.questions.every((question) => Boolean(answers[question.question]))

  const submit = () => {
    if (busy || !ready) return
    setBusy(true)
    onResolve(answers)
  }

  const choose = (index: number, label: string, multi: boolean) => {
    setSelected((current) => {
      const values = current[index] ?? []
      if (!multi) return { ...current, [index]: [label] }
      return {
        ...current,
        [index]: values.includes(label)
          ? values.filter((item) => item !== label)
          : [...values, label]
      }
    })
    setOtherOn((current) => (multi ? current : { ...current, [index]: false }))
  }

  const showPreview = (index: number, text: string | undefined) => {
    setPreview(text?.trim() ? { index, text } : null)
  }

  const toggleOther = (index: number, multi: boolean) => {
    const next = !otherOn[index]
    setOtherOn((current) => ({ ...current, [index]: next }))
    if (next && !multi) setSelected((values) => ({ ...values, [index]: [] }))
  }

  return (
    <m.section
      className="w1-perm w1-question"
      aria-label="Agent 提问"
      initial={{ opacity: 0, transform: 'translateY(8px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      exit={{ opacity: 0, transform: 'translateY(8px)', transition: { duration: DURATION.fast } }}
      transition={{ duration: DURATION.permissionIn, ease: EASE_OUT }}
    >
      <span className="w1-permglow" aria-hidden="true" />
      <div className="w1-ph">
        <span className="w1-pi">?</span>
        <span>// Agent 提问</span>
        <time>
          {request.questions.length} 个问题 · {ready ? '待提交' : '待回答'}
        </time>
      </div>

      <div className="w1-qbody">
        {request.questions.map((question, index) => (
          <fieldset className="w1-qgroup" key={question.question}>
            <legend>
              <span className="w1-qhead">{question.header}</span>
              <span>{question.multiSelect ? '多选' : '单选'}</span>
            </legend>
            <p className="w1-qtext">{question.question}</p>
            <div className="w1-qopts" role="group" aria-label={question.question}>
              {question.options.map((option) => {
                const on = (selected[index] ?? []).includes(option.label)
                return (
                  <label
                    key={option.label}
                    className={`w1-qopt${on ? ' on' : ''}`}
                    onMouseEnter={() => showPreview(index, option.preview)}
                    onFocus={() => showPreview(index, option.preview)}
                  >
                    <input
                      type={question.multiSelect ? 'checkbox' : 'radio'}
                      name={`question-${index}`}
                      checked={on}
                      onChange={() => choose(index, option.label, question.multiSelect === true)}
                    />
                    <span>
                      <b>{option.label}</b>
                      {option.description ? <small>{option.description}</small> : null}
                    </span>
                  </label>
                )
              })}
              <label
                className={`w1-qopt w1-qother${otherOn[index] ? ' on' : ''}`}
                onMouseEnter={() => showPreview(index, undefined)}
              >
                <input
                  type={question.multiSelect ? 'checkbox' : 'radio'}
                  name={`question-${index}`}
                  checked={otherOn[index] === true}
                  onChange={() => toggleOther(index, question.multiSelect === true)}
                />
                <span>
                  <b>其它</b>
                  <small>输入不在选项里的答案</small>
                  {otherOn[index] ? (
                    <input
                      className="w1-qotherinput"
                      type="text"
                      value={otherText[index] ?? ''}
                      maxLength={2000}
                      placeholder="输入自定义答案"
                      aria-label={`${question.question} · 其它答案`}
                      onChange={(event) =>
                        setOtherText((current) => ({
                          ...current,
                          [index]: event.target.value
                        }))
                      }
                      onFocus={() => {
                        setOtherOn((current) => ({ ...current, [index]: true }))
                        if (!question.multiSelect) {
                          setSelected((values) => ({ ...values, [index]: [] }))
                        }
                      }}
                    />
                  ) : null}
                </span>
              </label>
            </div>
            {preview?.index === index ? <pre className="w1-qpreview">{preview.text}</pre> : null}
          </fieldset>
        ))}
      </div>

      <div className="w1-qacts">
        <button
          className="w1-pb"
          type="button"
          disabled={busy}
          onClick={() => {
            if (busy) return
            setBusy(true)
            onResolve(null)
          }}
        >
          拒绝回答
        </button>
        <button className="w1-pb pri" type="button" disabled={busy || !ready} onClick={submit}>
          提交回答
        </button>
      </div>
    </m.section>
  )
}
