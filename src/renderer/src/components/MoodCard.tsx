import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { dateKey } from '../../../shared/date-key'
import { energyLabel, moodEmoji, moodLabel } from '../lib/mood'
import { useMood } from '../lib/use-mood'
import { SpotlightLayer } from './effects/SpotlightLayer'
import { MoodStatsSheet } from './MoodStatsSheet'

const LEVELS = [1, 2, 3, 4, 5]

export function MoodCard() {
  const { today, ready, save } = useMood()
  const [mood, setMood] = useState(3)
  const [energy, setEnergy] = useState(3)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const statsButtonRef = useRef<HTMLButtonElement>(null)
  const day = dateKey()

  useEffect(() => {
    if (!today) return
    setMood(today.mood)
    setEnergy(today.energy)
    setNote(today.note)
  }, [today])

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      await save({ day, mood, energy, note })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <section className="w1-card w1-moodcard" data-spotlight>
        <SpotlightLayer />
        <div className="w1-ct">
          <b>
            <em>//</em>今日心情
          </b>
          <div className="w1-ctmeta">
            <span>{today ? `${moodEmoji(today.mood)} 已记录` : '未记录'}</span>
            <button
              ref={statsButtonRef}
              className="w1-hmanage"
              type="button"
              aria-label="心情趋势"
              onClick={() => setStatsOpen(true)}
            >
              趋势
            </button>
          </div>
        </div>

        <div className="w1-moodbody">
          <div className="w1-moodrow">
            <span className="w1-moodlabel">心情</span>
            <div className="w1-moodpick" role="group" aria-label="心情等级">
              {LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`w1-moodemoji${mood === level ? ' on' : ''}`}
                  aria-pressed={mood === level}
                  aria-label={`心情 ${moodLabel(level)}`}
                  title={moodLabel(level)}
                  onClick={() => setMood(level)}
                >
                  {moodEmoji(level)}
                </button>
              ))}
            </div>
          </div>

          <div className="w1-moodrow">
            <span className="w1-moodlabel">精力</span>
            <div className="w1-moodpick" role="group" aria-label="精力等级">
              {LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`w1-moodlevel${energy === level ? ' on' : ''}`}
                  aria-pressed={energy === level}
                  aria-label={`精力 ${energyLabel(level)}`}
                  title={energyLabel(level)}
                  onClick={() => setEnergy(level)}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <input
            className="w1-moodnote"
            type="text"
            placeholder="一句话（可选）"
            aria-label="心情备注"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />

          <button
            className="w1-pb pri w1-moodsave"
            type="button"
            disabled={!ready || saving}
            onClick={handleSave}
          >
            {saving ? '记录中…' : today ? '更新今天' : '记录今天'}
          </button>
        </div>
      </section>

      <AnimatePresence onExitComplete={() => statsButtonRef.current?.focus()}>
        {statsOpen ? <MoodStatsSheet onClose={() => setStatsOpen(false)} /> : null}
      </AnimatePresence>
    </>
  )
}
