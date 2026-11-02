/** 用同 id 的新记录替换列表中的旧记录；找不到时原样返回。 */
export function replaceById<T extends { id: string }>(list: T[], next: T): T[] {
  return list.map((item) => (item.id === next.id ? next : item))
}
