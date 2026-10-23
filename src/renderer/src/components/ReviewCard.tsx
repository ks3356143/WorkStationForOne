import { useWorkstation } from '../store/useWorkstation'

export function ReviewCard() {
  const startFocus = useWorkstation((state) => state.startFocus)

  return (
    <section className="w1-card">
      <div className="w1-ct">
        <b>
          <em>//</em>学习与复习
        </b>
        <span>今天</span>
      </div>

      <div className="w1-numrow">
        <span className="w1-big">12</span>
        <span className="w1-unit">
          张卡到期
          <br />
          预计 18 分钟
        </span>
      </div>

      <div className="w1-rbar">
        <i style={{ width: '42%', background: '#7C5CFF', opacity: 0.85 }} />
        <i style={{ width: '33%', background: '#2DE2E6', opacity: 0.7 }} />
        <i style={{ width: '25%', background: '#5B6C8A', opacity: 0.7 }} />
      </div>
      <div className="w1-rmeta">
        <span>线代 5</span>
        <span>概率论 4</span>
        <span>英语 3</span>
      </div>

      <button className="w1-rbtn" type="button" onClick={() => startFocus('复习 · 12 张卡', 18)}>
        开始复习 <span>约 18 分钟 →</span>
      </button>
    </section>
  )
}
