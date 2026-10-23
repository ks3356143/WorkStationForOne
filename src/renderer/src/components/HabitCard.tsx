import { getTodayIndex, getWeekdayCn } from '../lib/date'
import { useNow } from '../lib/useNow'
import { useWorkstation } from '../store/useWorkstation'

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export function HabitCard() {
  const habits = useWorkstation((state) => state.habits)
  const toggleHabitToday = useWorkstation((state) => state.toggleHabitToday)
  const now = useNow(60_000)
  const today = getTodayIndex(now)
  const doneCount = habits.filter((habit) => habit.days[today]).length

  return (
    <section className="w1-card">
      <div className="w1-ct">
        <b>
          <em>//</em>习惯打卡
        </b>
        <span>
          {doneCount} / {habits.length} · {getWeekdayCn(now)}
        </span>
      </div>

      <div className="w1-habits">
        <div className="w1-hrow">
          <span />
          {DAY_LABELS.map((label, index) => (
            <span key={label} className={`w1-hday${index === today ? ' today' : ''}`}>
              {label}
            </span>
          ))}
        </div>
        {habits.map((habit) => (
          <div className="w1-hrow" key={habit.id}>
            <span className="w1-hname">{habit.name}</span>
            {habit.days.map((done, index) => (
              <button
                key={index}
                type="button"
                className={[
                  'w1-hdot',
                  done ? 'on' : index < today ? 'miss' : '',
                  index === today ? 'today' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={index !== today}
                aria-label={`${habit.name} · 周${DAY_LABELS[index]}${done ? ' · 已完成' : ''}`}
                aria-pressed={index === today ? done : undefined}
                onClick={() => toggleHabitToday(habit.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
