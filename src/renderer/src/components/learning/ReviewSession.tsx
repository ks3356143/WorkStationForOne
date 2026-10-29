import { useEffect, useState } from 'react'
import { m } from 'motion/react'
import { clozePlainText } from '../../../../shared/cloze'
import { dateKey } from '../../../../shared/date-key'
import { scheduleReview, type SrsRating } from '../../../../shared/srs'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { tallyLine } from '../../lib/learning'
import { useNow } from '../../lib/useNow'
import { useWorkstation } from '../../store/useWorkstation'

const RATINGS: { value: SrsRating; label: string; hint: string; tone: string }[] = [
  { value: 1, label: '重来', hint: '1', tone: 'again' },
  { value: 2, label: '困难', hint: '2', tone: 'hard' },
  { value: 3, label: '良好', hint: '3', tone: 'good' },
  { value: 4, label: '简单', hint: '4', tone: 'easy' }
]

interface ReviewSessionProps {
  onExit: () => void
}

export function ReviewSession({ onExit }: ReviewSessionProps) {
  const items = useWorkstation((state) => state.learningItems)
  const session = useWorkstation((state) => state.learningReviewSession)
  const tally = useWorkstation((state) => state.learningReviewTally)
  const reviewItem = useWorkstation((state) => state.reviewLearningItem)
  const now = useNow(60_000)
  const today = dateKey(now)
  const [flipped, setFlipped] = useState(false)

  const queue = session ?? []
  const current = queue.length > 0 ? items.find((item) => item.id === queue[0]) : undefined
  const done = queue.length === 0

  // biome-ignore lint/correctness/useExhaustiveDependencies: 换到下一张卡时要重置翻面状态，id 就是触发条件
  useEffect(() => {
    setFlipped(false)
  }, [current?.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }
      if (!current) return
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        setFlipped(true)
        return
      }
      if (!flipped) return
      const rating = Number(event.key)
      if (rating >= 1 && rating <= 4) {
        event.preventDefault()
        reviewItem(current.id, rating as SrsRating)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [current, flipped, onExit, reviewItem])

  if (done) {
    const finished = tally.reviewed > 0
    return (
      <section className="w1-workspace w1-learn review" aria-label="复习完成">
        <div className="w1-lreview">
          <div className="w1-ldone">
            <span className="w1-eyebrow">// 复习</span>
            <h1 className="w1-ldonetitle">{finished ? '这一轮结束了' : '今天没有到期卡片'}</h1>
            <p className="w1-ldonetext">
              {finished ? tallyLine(tally) : '新建一张卡，或把复习日调到今天，队列就会出现在这里。'}
            </p>
            <div className="w1-ldoneacts">
              <button className="w1-pb pri" type="button" onClick={onExit}>
                回到卡片库
              </button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  const state = current
    ? {
        repetitions: current.repetitions,
        intervalDays: current.intervalDays,
        stability: current.stability,
        difficulty: current.difficulty,
        lapses: current.lapses,
        lastReviewOn: current.lastReviewOn,
        lastReviewedAt: current.lastReviewedAt
      }
    : null
  const total = queue.length + tally.reviewed
  const position = Math.min(tally.reviewed + 1, total)

  return (
    <section className="w1-workspace w1-learn review" aria-label="复习会话">
      <div className="w1-lreview">
        <header className="w1-lrevhead">
          <div className="w1-lrevmeta">
            <span className="w1-eyebrow">// 复习</span>
            <span className="w1-lrevcount">
              <b>{position}</b> / {Math.max(total, 1)}
            </span>
            {current ? <span className="w1-lrevsubject">{current.subject}</span> : null}
          </div>
          <button className="w1-lrevquit" type="button" onClick={onExit} aria-label="退出复习">
            退出复习 <kbd>Esc</kbd>
          </button>
        </header>

        <button
          className={`w1-lcard${flipped ? ' flipped' : ''}`}
          type="button"
          onClick={() => setFlipped(true)}
          aria-label={flipped ? '卡片背面' : '点击翻面显示答案'}
        >
          <m.div
            className="w1-lface w1-lfront"
            animate={{ opacity: flipped ? 0 : 1 }}
            transition={{ duration: DURATION.reveal, ease: EASE_OUT }}
            aria-hidden={flipped}
          >
            <span className="w1-lcardtag">正面</span>
            <strong className="w1-lcardtitle">{current?.title}</strong>
            {current?.clozeSource ? (
              <span className="w1-lcardhint">挖空卡 · 回忆被标记的部分</span>
            ) : (
              <span className="w1-lcardhint">按 Space 或点击翻面</span>
            )}
          </m.div>

          <m.div
            className="w1-lface w1-lback"
            initial={false}
            animate={{ opacity: flipped ? 1 : 0 }}
            transition={{ duration: DURATION.reveal, ease: EASE_OUT }}
            aria-hidden={!flipped}
          >
            <span className="w1-lcardtag">背面</span>
            {current?.source ? <span className="w1-lcardsource">{current.source}</span> : null}
            {current?.clozeSource ? (
              <p className="w1-lcardnotes w1-lcardcloze">{clozePlainText(current.clozeSource)}</p>
            ) : (
              <p className="w1-lcardnotes">{current?.notes || '这张卡还没有背面。'}</p>
            )}
          </m.div>
        </button>

        <div className="w1-lratings" role="group" aria-label="评分">
          {RATINGS.map((rating) => {
            const preview = state ? scheduleReview(state, rating.value, today).intervalDays : 0
            return (
              <button
                key={rating.value}
                type="button"
                className={`w1-lrate ${rating.tone}`}
                disabled={!flipped}
                title={flipped ? undefined : '先翻面再评分'}
                onClick={() => current && reviewItem(current.id, rating.value)}
              >
                <b>{rating.label}</b>
                <span>{preview === 0 ? '今天' : `${preview} 天`}</span>
                <kbd>{rating.hint}</kbd>
              </button>
            )
          })}
        </div>

        {flipped ? null : (
          <button className="w1-lflip" type="button" onClick={() => setFlipped(true)}>
            显示答案 <kbd>Space</kbd>
          </button>
        )}
      </div>
    </section>
  )
}
