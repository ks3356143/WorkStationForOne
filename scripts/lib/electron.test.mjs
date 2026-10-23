import { describe, expect, it } from 'vitest'
import { withoutElectronRunAsNode } from './electron.mjs'

describe('withoutElectronRunAsNode', () => {
  it('removes the flag regardless of casing', () => {
    const env = withoutElectronRunAsNode({
      ELECTRON_RUN_AS_NODE: '1',
      electron_run_as_node: '1',
      Electron_Run_As_Node: '1',
      PATH: 'C:\\Windows'
    })

    expect(env).toEqual({ PATH: 'C:\\Windows' })
  })

  it('does not mutate the source environment', () => {
    const source = { electron_run_as_node: '1', PATH: 'C:\\Windows' }

    withoutElectronRunAsNode(source)

    expect(source).toEqual({ electron_run_as_node: '1', PATH: 'C:\\Windows' })
  })
})
