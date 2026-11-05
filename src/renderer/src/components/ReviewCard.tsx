import { SpotlightLayer } from './effects/SpotlightLayer'
import { dateKey } from '../../../shared/date-key'
import { deferredNewCount, dueQueue, estimatedMinutes, subjectStacks } from '../lib/learning'
import { useNow } from '../lib/useNow'
import { useWorkstation } from '../store/useWorkstation'

const PALETTE = ['var(--ac)', 'var(--ac2)', 'var(--su)']

export function ReviewCard() {
  const learningItems = useWorkstation((state) => state.learningItems)
  const learningNewPerDay = useWorkstation((state) => state.learningNewPerDay)
  const learningNewIntroduced = useWorkstation((state) => state.learningNewIntroduced)
  const startLearningReview = useWorkstation((state) => state.startLearningReview)
  const setView = useWorkstation((state) => state.setView)
  const now = useNow(60_000)
  const today = dateKey(now)
  const due = dueQueue(learningItems, today, {
    perDay: learningNewPerDay,
    introducedToday: learningNewIntroduced
  })
  const minutes = estimatedMinutes(due.length)
  const stacks = subjectStacks(due, 3)
  const deferredNew = deferredNewCount(learningItems, today, {
    perDay: learningNewPerDay,
    introducedToday: learningNewIntroduced
  })

  return (
    <section className="w1-card w1-review" aria-label="学习与复习" data-spotlight>
      <SpotlightLayer />
      <div className="w1-ct">
        <b>
          <em>//</em>学习与复习
        </b>
        <span>今天</span>
      </div>

      <div className="w1-numrow">
        <span className="w1-big">{due.length}</span>
        <span className="w1-unit">
          张卡到期
          <br />
          {due.length > 0
            ? `预计 ${minutes} 分钟`
            : deferredNew > 0
              ? `${deferredNew} 张新卡已留到明天`
              : '今天没有到期卡片'}
        </span>
      </div>

      {stacks.length > 0 ? (
        <>
          <div className="w1-rbar">
            {stacks.map((stack, index) => (
              <i
                key={stack.subject}
                style={{
                  width: `${(stack.share * 100).toFixed(2)}%`,
                  background: PALETTE[Math.min(index, PALETTE.length - 1)],
                  opacity: 0.85 - index * 0.12
                }}
              />
            ))}
          </div>
          <div className="w1-rmeta">
            {stacks.map((stack) => (
              <span key={stack.subject}>
                {stack.subject} {stack.count}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="w1-rempty">
          {deferredNew > 0
            ? `${deferredNew} 张新卡已留到明天，今天先复习到这里。`
            : '今天没有到期卡片，可以去卡片库补几张。'}
        </div>
      )}

      <button
        className="w1-rbtn"
        type="button"
        onClick={() => (due.length > 0 ? startLearningReview() : setView('learning'))}
      >
        开始复习 <span>{due.length > 0 ? `约 ${minutes} 分钟 →` : '查看卡片库 →'}</span>
      </button>
    </section>
  )
}
