import { describe, expect, it } from 'vitest'
import { describeMcpSource, sourceLabel } from './tool-update'

describe('sourceLabel', () => {
  it('三类来源中文标签', () => {
    expect(sourceLabel('cli')).toBe('本机 CLI')
    expect(sourceLabel('mcp')).toBe('MCP')
    expect(sourceLabel('plugin')).toBe('插件')
    expect(sourceLabel(undefined)).toBe('')
  })
})

describe('describeMcpSource', () => {
  it('HTTP 视为外部服务', () => {
    expect(describeMcpSource('http').label).toContain('外部')
  })

  it('stdio 从命令推断本机依赖', () => {
    expect(describeMcpSource('stdio', 'npx -y @modelcontextprotocol/server-filesystem')).toEqual({
      label: '本机 · Node',
      dependency: 'Node'
    })
    expect(describeMcpSource('stdio', 'C:\\tools\\uvx.exe mcp-server-fetch').label).toBe(
      '本机 · uv'
    )
    expect(describeMcpSource('stdio', 'git mcp').label).toBe('本机 · git')
    expect(describeMcpSource('stdio', 'my-server.exe --flag').label).toBe('本机进程')
  })

  it('缺少命令时只标本机进程', () => {
    expect(describeMcpSource('stdio', '').label).toBe('本机进程')
  })
})
