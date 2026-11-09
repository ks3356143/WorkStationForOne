import { useEffect, useMemo, useState } from 'react'
import { fallbackCopy } from '../../lib/clipboard'
import {
  CLI_CATEGORY_LABELS,
  CLI_RECOMMEND_CATEGORIES,
  RECOMMENDED_CLI_TOOLS,
  type CliRecommendCategory
} from '../../../../shared/recommendations'
import { StatePlaceholder } from '../StatePlaceholder'

interface RecommendationsTabProps {
  notify: (text: string) => void
}

/**
 * 工具推荐：精选 CLI（winget 安装命令已核对），只读展示 + 本地 PATH 检测。
 * 不自动安装、不联网；清单随应用版本更新。
 */
export function RecommendationsTab({ notify }: RecommendationsTabProps) {
  const api = typeof window === 'undefined' ? undefined : window.ws?.capability
  const [installed, setInstalled] = useState<Record<string, boolean> | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CliRecommendCategory | 'all'>('all')

  const load = () => {
    if (!api?.cliRecommend) {
      setInstalled({})
      return
    }
    void api
      .cliRecommend()
      .then(setInstalled)
      .catch(() => setInstalled({}))
  }

  useEffect(() => {
    if (!api) {
      setInstalled({})
      return
    }
    let alive = true
    void api
      .cliRecommend()
      .then((next) => {
        if (alive) setInstalled(next)
      })
      .catch(() => {
        if (alive) setInstalled({})
      })
    return () => {
      alive = false
    }
  }, [api])

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return RECOMMENDED_CLI_TOOLS.filter(
      (tool) =>
        (category === 'all' || tool.category === category) &&
        (!keyword ||
          tool.name.toLowerCase().includes(keyword) ||
          tool.summary.toLowerCase().includes(keyword) ||
          tool.why.toLowerCase().includes(keyword))
    )
  }, [query, category])

  const installedCount = Object.values(installed ?? {}).filter(Boolean).length

  const copyCommand = (command: string) => {
    const done = () => notify(`已复制 ${command}`)
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(command).then(done, () => fallbackCopy(command, done))
      return
    }
    fallbackCopy(command, done)
  }

  const openRepo = (repo: string) => {
    window.open(repo, '_blank', 'noopener')
  }

  return (
    <section className="w1-capsection" aria-label="工具推荐">
      <div className="w1-caphead">
        <span className="w1-capkicker">// TOOLBOX</span>
        <span className="w1-capnote">
          精选 CLI：快、成熟、Windows 可直接 winget 安装；只做本地 PATH 检测，不自动安装、不联网
        </span>
        <div className="w1-capactions">
          <button type="button" className="w1-capmini" onClick={load}>
            重新检测
          </button>
          <span className="w1-capscope">
            已装 {installedCount}/{RECOMMENDED_CLI_TOOLS.length}
          </span>
        </div>
      </div>

      <div className="w1-capmarketbar">
        <input
          className="w1-capsearch"
          value={query}
          placeholder="搜索工具、用途或理由…"
          aria-label="搜索推荐工具"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="w1-capseg w1-capsort" role="group" aria-label="按分类筛选">
          <button
            type="button"
            className={category === 'all' ? 'on' : ''}
            aria-pressed={category === 'all'}
            onClick={() => setCategory('all')}
          >
            全部
          </button>
          {CLI_RECOMMEND_CATEGORIES.map((value) => (
            <button
              key={value}
              type="button"
              className={category === value ? 'on' : ''}
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
            >
              {CLI_CATEGORY_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      {installed === null ? (
        <StatePlaceholder kind="loading" rows={4} />
      ) : visible.length === 0 ? (
        <div className="w1-capemptycard">
          <b>没有匹配的工具。</b>
          <p>换个关键词，或切回「全部」分类。</p>
        </div>
      ) : (
        <div className="w1-caplist">
          {visible.map((tool) => {
            const ok = installed[tool.id] === true
            return (
              <div className={`w1-caprow static rec${ok ? ' installed' : ''}`} key={tool.id}>
                <span className="w1-capglyph">CL</span>
                <span className="w1-capcopy">
                  <b>
                    {tool.name}
                    <i className="w1-capver">{CLI_CATEGORY_LABELS[tool.category]}</i>
                  </b>
                  <p>{tool.summary}</p>
                  <p className="w1-capwhy">{tool.why}</p>
                  <code className="w1-capcmd">{tool.install.command}</code>
                </span>
                <span className="w1-capactions">
                  <span className={`w1-capbadge${ok ? '' : ' off'}`}>
                    {ok ? '已安装' : '未安装'}
                  </span>
                  <button
                    type="button"
                    className="w1-capmini"
                    aria-label={`复制 ${tool.name} 安装命令`}
                    onClick={() => copyCommand(tool.install.command)}
                  >
                    复制命令
                  </button>
                  <button
                    type="button"
                    className="w1-capmini"
                    aria-label={`打开 ${tool.name} 仓库`}
                    onClick={() => openRepo(tool.repo)}
                  >
                    仓库
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}
      <p className="w1-capnote">
        清单是内置精选（2026-11 核对 winget 官方 ID），不随网络变化；安装后点「重新检测」刷新状态。
        这些是本机命令行工具，不进入 Agent 的工具链路。
      </p>
    </section>
  )
}
