/**
 * IPC 入参守卫。
 * 渲染层不可信，所有 handler 都必须在这里过一遍；错误消息保持中文短句，
 * 界面会把它当成可直接展示的原因。
 */

export const DEFAULT_MAX_ID = 120

/** 记录对象：拒绝 null 与数组，返回可索引的副本。 */
export function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label}必须是对象`)
  }
  return value as Record<string, unknown>
}

export function assertId(value: unknown, label: string, max = DEFAULT_MAX_ID): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new TypeError(`${label}无效`)
  }
  return value
}

/** 原样返回字符串（不裁剪），超长即拒绝。 */
export function assertText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label}无效`)
  if (value.length > max) throw new TypeError(`${label}过长`)
  return value
}

/** 裁剪后必须非空，用于名称、标题这类字段。 */
export function assertFilled(value: unknown, label: string, max: number): string {
  const text = assertText(value, label, max).trim()
  if (!text) throw new TypeError(`${label}不能为空`)
  return text
}

export function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label}无效`)
  return value
}

export function assertEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`${label}无效`)
  }
  return value as T
}

/**
 * 更新补丁不允许为空：空补丁会让仓储层执行一条无意义的 UPDATE，
 * 也会让界面显示「已保存」但什么都没变。
 */
export function assertNotEmpty<T extends object>(patch: T, label: string): T {
  if (Object.keys(patch).length === 0) throw new TypeError(`${label}没有可更新字段`)
  return patch
}
