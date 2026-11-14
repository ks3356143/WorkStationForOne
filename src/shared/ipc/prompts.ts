/** Composer `/` 快捷指令的可复用提示词模板。 */
export interface PromptTemplateRecord {
  id: string
  name: string
  body: string
  createdAt: number
  updatedAt: number
}

export interface PromptTemplateInput {
  /** 传入即更新已有模板；省略则新建 */
  id?: string
  name: string
  body: string
}

export interface PromptApi {
  list: () => Promise<PromptTemplateRecord[]>
  save: (input: PromptTemplateInput) => Promise<PromptTemplateRecord>
  remove: (id: string) => Promise<boolean>
}
