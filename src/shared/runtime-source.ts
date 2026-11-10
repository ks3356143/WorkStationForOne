/** 同一个 CLI 的系统源与托管源二选一；缺失时回退另一侧，两侧都无才失效。 */
export type CliSource = 'system' | 'managed'

export interface CliSourceState {
  systemAvailable: boolean
  managedInstalled: boolean
}

export function defaultSource(state: CliSourceState): CliSource {
  return state.systemAvailable ? 'system' : 'managed'
}

export function effectiveSource(
  preference: CliSource | null | undefined,
  state: CliSourceState
): CliSource | null {
  const chosen = preference ?? defaultSource(state)
  if (chosen === 'system') {
    if (state.systemAvailable) return 'system'
    return state.managedInstalled ? 'managed' : null
  }
  if (state.managedInstalled) return 'managed'
  return state.systemAvailable ? 'system' : null
}
