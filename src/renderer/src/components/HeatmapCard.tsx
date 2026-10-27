import { dateKey } from '../../../shared/date-key'
import { completionHeatmap, heatLevel } from '../lib/heatmap'
import { useNow } from '../lib/useNow'
import { useWorkstation } from '../store/useWorkstation'

const WEEKS = 26

export function HeatmapCard() {
  const tasks = useWorkstation((state) => state.tasks)
  const now = useNow(60_000)
  const heatmap = completionHeatmap(tasks, dateKey(now), WEEKS)

  return (
    <section className="w1-card w1-heat" aria-label="完成记录">
      <div className="w1-heathead">
        <div>
          <div className="w1-date">
            <i>//</i> 完成记录
          </div>
          <h2 className="w1-heattitle">近 {WEEKS} 周</h2>
        </div>
        <div className="w1-heatstats">
          <span>
            <b>{heatmap.total}</b> 项完成
          </span>
          <span>
            <b>{heatmap.activeDays}</b> 天有记录
          </span>
          <span>
            最多一天 <b>{heatmap.max}</b> 项
          </span>
        </div>
      </div>

      <div className="w1-heatbody">
        <div
          className="w1-heatgrid"
          role="img"
          aria-label={`近 ${WEEKS} 周完成 ${heatmap.total} 项任务，${heatmap.activeDays} 天有记录，最多一天 ${heatmap.max} 项`}
        >
          {heatmap.weeks.map((week, weekIndex) => (
            <div className="w1-heatcol" key={week.days[0]?.key ?? `week-${weekIndex}`}>
              {week.days.map((day, dayIndex) =>
                day ? (
                  <i
                    key={day.key}
                    data-level={heatLevel(day.count)}
                    title={`${day.key} · ${day.count} 项`}
                  />
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 未来日期是固定位置的占位格，索引就是位置
                  <i key={`empty-${dayIndex}`} className="is-empty" />
                )
              )}
            </div>
          ))}
        </div>

        <div className="w1-heatlegend" aria-hidden="true">
          <span>少</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} data-level={level} />
          ))}
          <span>多</span>
        </div>
      </div>
    </section>
  )
}
