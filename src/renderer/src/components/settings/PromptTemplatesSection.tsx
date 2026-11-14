import { useEffect, useState } from 'react'
import type { PromptTemplateRecord } from '../../../../shared/ipc'
import { useListAnimate } from '../../lib/use-list-animate'

/** 设置页「提示词模板」管理：Composer 输入 / 可插入这些模板，{变量} 为占位。 */
export function PromptTemplatesSection({ notify }: { notify: (text: string) => void }) {
  const api = typeof window === 'undefined' ? undefined : window.ws?.prompts
  const [templates, setTemplates] = useState<PromptTemplateRecord[]>([])
  const [form, setForm] = useState<null | { id?: string }>(null)
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [armDelete, setArmDelete] = useState<string | null>(null)
  const listAnim = useListAnimate<HTMLDivElement>()

  const reload = () => {
    if (!api) return
    void api
      .list()
      .then(setTemplates)
      .catch(() => setTemplates([]))
  }
  useEffect(reload, [api])

  useEffect(() => {
    if (!armDelete) return
    const timer = window.setTimeout(() => setArmDelete(null), 4000)
    return () => window.clearTimeout(timer)
  }, [armDelete])

  const openNew = () => {
    setForm({})
    setName('')
    setBody('')
  }
  const openEdit = (template: PromptTemplateRecord) => {
    setForm({ id: template.id })
    setName(template.name)
    setBody(template.body)
  }
  const save = () => {
    if (!api || busy) return
    if (!name.trim() || !body.trim()) {
      notify('名称与正文都不能为空')
      return
    }
    setBusy(true)
    void api
      .save({ ...(form?.id ? { id: form.id } : {}), name, body })
      .then(() => {
        setForm(null)
        reload()
        notify('已保存提示词模板')
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : '保存失败'))
      .finally(() => setBusy(false))
  }
  const remove = (template: PromptTemplateRecord) => {
    if (!api) return
    if (armDelete !== template.id) {
      setArmDelete(template.id)
      return
    }
    setArmDelete(null)
    void api
      .remove(template.id)
      .then(() => {
        reload()
        notify(`已删除模板：${template.name}`)
      })
      .catch(() => notify('删除失败'))
  }

  return (
    <section className="w1-setgroup" aria-label="提示词模板">
      <h3>提示词模板</h3>
      <p className="w1-provnote">
        在 Agent 输入框输入 <code>/</code> 即可挑选模板插入；正文里的 {'{变量}'}{' '}
        是占位，插入后会自动选中第一个。
      </p>
      {!api ? (
        <p className="w1-provnote">仅在桌面应用可用。</p>
      ) : (
        <>
          <div className="w1-ptops">
            <button type="button" className="w1-setbtn" onClick={openNew}>
              新建模板
            </button>
          </div>
          {form ? (
            <div className="w1-ptform">
              <input
                value={name}
                maxLength={80}
                placeholder="模板名称（如：代码审查）"
                aria-label="模板名称"
                onChange={(event) => setName(event.target.value)}
              />
              <textarea
                value={body}
                rows={5}
                maxLength={20000}
                placeholder="模板正文，可用 {文件} {要求} 等占位…"
                aria-label="模板正文"
                onChange={(event) => setBody(event.target.value)}
              />
              <div className="w1-ptformops">
                <button type="button" className="w1-setbtn" disabled={busy} onClick={save}>
                  {busy ? '保存中…' : '保存'}
                </button>
                <button type="button" className="w1-setbtn" onClick={() => setForm(null)}>
                  取消
                </button>
              </div>
            </div>
          ) : null}
          <div className="w1-ptlist" ref={listAnim}>
            {templates.map((template) => (
              <div className="w1-ptrow" key={template.id}>
                <div className="w1-ptmain">
                  <b>{template.name}</b>
                  <span>{template.body}</span>
                </div>
                <span className="w1-ptrowops">
                  <button type="button" className="w1-setbtn" onClick={() => openEdit(template)}>
                    编辑
                  </button>
                  <button type="button" className="w1-setbtn" onClick={() => remove(template)}>
                    {armDelete === template.id ? '确认删除' : '删除'}
                  </button>
                </span>
              </div>
            ))}
            {templates.length === 0 ? (
              <p className="w1-provnote">还没有模板，点「新建模板」添加。</p>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
