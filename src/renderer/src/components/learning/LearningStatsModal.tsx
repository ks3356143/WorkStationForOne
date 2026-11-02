import { m } from 'motion/react'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { dailyReviewCounts, learningStats, ratingDistribution } from '../../lib/learning-stats'
import type { LearningItemRecord, LearningReviewRecord } from '../../../../shared/ipc'
import type { LearningItem } from '../../types'

interface LearningStatsModalProps {
  items: LearningItem[] | LearningItemRecord[]
  reviewHistory: LearningReviewRecord[]
  today: string
  onClose: () => void
}

/** 学习统计弹层：只读学习卡与复习历史，所有口径来自 lib/learning-stats。 */
export function LearningStatsModal({
  items,
  reviewHistory,
  today,
  onClose
}: LearningStatsModalProps) {
  const stats = learningStats(items, today)
  const peak = Math.max(1, ...stats.forecast.map((day) => day.count))
  const reviewDays = dailyReviewCounts(reviewHistory, today)
  const reviewTotal = reviewDays.reduce((sum, day) => sum + day.count, 0)
  const reviewPeak = Math.max(1, ...reviewDays.map((day) => day.count))
  const ratings = ratingDistribution(reviewHistory, today)
  const masteryTotal = stats.mastery.fresh + stats.mastery.learning + stats.mastery.mature
  const share = (count: number) => (masteryTotal > 0 ? `${(count / masteryTotal) * 100}%` : '0%')
  const retentionLabel = stats.retention === null ? '—' : `${Math.round(stats.retention * 100)}%`

  return (
    <m.div
      className="w1-modalbackdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
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
          <button className="w1-modalx" type="button" aria-label="关闭" onClick={() => onClose()}>
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
            <small>{stats.reviewed > 0 ? `${stats.reviewed} 张可估算` : '复习后开始估算'}</small>
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
                      height: day.count === 0 ? '2px' : `${Math.max(10, (day.count / peak) * 100)}%`
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
          <span className="w1-lstatlabel">
            // 最近 14 天复习 <b>{reviewTotal}</b> 次
          </span>
          {reviewTotal === 0 ? (
            <p className="w1-lstatempty">最近 14 天还没有复习记录。</p>
          ) : (
            <div
              className="w1-lreviewchart"
              role="img"
              aria-label={`最近 14 天复习 ${reviewTotal} 次`}
            >
              {reviewDays.map((day, index) => (
                <div className="w1-lreviewday" key={day.day}>
                  <span className="w1-lreviewbar" aria-hidden="true">
                    <i
                      style={{
                        height:
                          day.count === 0
                            ? '2px'
                            : `${Math.max(8, (day.count / reviewPeak) * 100)}%`
                      }}
                    />
                  </span>
                  <b>{day.count}</b>
                  <small>
                    {index === 0 ||
                    index === Math.floor(reviewDays.length / 2) ||
                    index === reviewDays.length - 1
                      ? day.label
                      : ''}
                  </small>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="w1-lstatblock">
          <span className="w1-lstatlabel">// 评分分布</span>
          {reviewTotal === 0 ? (
            <p className="w1-lstatempty">还没有可统计的评分。</p>
          ) : (
            <>
              <div className="w1-lratestack" aria-hidden="true">
                {ratings.map((bucket) => (
                  <i
                    key={bucket.rating}
                    className={`r${bucket.rating}`}
                    style={{ width: `${bucket.share * 100}%` }}
                  />
                ))}
              </div>
              <div className="w1-lstatlegend">
                {ratings.map((bucket) => (
                  <span key={bucket.rating}>
                    <i className={`r${bucket.rating}`} />
                    {bucket.label} {bucket.count}
                  </span>
                ))}
              </div>
            </>
          )}
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
          <button className="w1-pb" type="button" onClick={() => onClose()}>
            关闭
          </button>
        </div>
      </m.div>
    </m.div>
  )
}
