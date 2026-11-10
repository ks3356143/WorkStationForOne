/** 本机 CLI 工具推荐清单：纯数据，随应用发布；安装命令已按 winget 官方 ID 核对。 */
export type CliRecommendCategory =
  | 'search'
  | 'view'
  | 'text'
  | 'files'
  | 'system'
  | 'dev'
  | 'runtime'

export const CLI_RECOMMEND_CATEGORIES: CliRecommendCategory[] = [
  'search',
  'view',
  'text',
  'files',
  'system',
  'dev',
  'runtime'
]

export const CLI_CATEGORY_LABELS: Record<CliRecommendCategory, string> = {
  search: '搜索',
  view: '查看',
  text: '文本',
  files: '文件与磁盘',
  system: '系统',
  dev: '开发流',
  runtime: '环境依赖'
}

/** 环境依赖的托管安装元数据；资产命名参考 Cherry Studio 的 download-binaries。 */
export interface MirrorAsset {
  url: string
  sha256?: string
}

export interface CliRuntimeMeta {
  /** 查最新版本的只读端点；失败静默跳过 */
  releaseApi: string
  /** release tag 前缀（bun-v / v），node 的 index.json 直接给纯版本 */
  tagPrefix: string
  assetUrl: (version: string) => string
  /** 可信回退源（npmmirror / 阿里云 PyPI）；可带 sha256 做校验 */
  mirrorAsset?: (version: string) => MirrorAsset | null | Promise<MirrorAsset | null>
  /** 版本查询不可达时的保底版本（已核对） */
  fallbackVersion?: string
  /** zip 内需要的二进制；解压后递归查找只拷贝这些 */
  binaries: string[]
  /** 系统源行的升级命令 ID */
  wingetId: string
}

export interface CliRecommendation {
  id: string
  name: string
  category: CliRecommendCategory
  /** 一句话用途 */
  summary: string
  /** 为什么值得装（速度 / 成熟度） */
  why: string
  repo: string
  install: { manager: 'winget'; command: string }
  /** PATH 里命中的可执行名（小写、无扩展名） */
  detect: string[]
  /** 仅环境依赖：支持应用托管安装与源选择 */
  runtime?: CliRuntimeMeta
}

export const RECOMMENDED_CLI_TOOLS: CliRecommendation[] = [
  {
    id: 'ripgrep',
    name: 'ripgrep',
    category: 'search',
    summary: '递归搜文本，默认尊重 .gitignore，比 grep 快一个量级。',
    why: 'Rust 编写，搜索工具的事实标准；Agent 与脚本都常直接调用。',
    repo: 'https://github.com/BurntSushi/ripgrep',
    install: { manager: 'winget', command: 'winget install --id BurntSushi.ripgrep.MSVC -e' },
    detect: ['rg']
  },
  {
    id: 'fd',
    name: 'fd',
    category: 'search',
    summary: '找文件：语法比 find 简单，默认忽略隐藏目录与 gitignore。',
    why: 'Rust 编写，速度快、跨平台一致，脚本里最省心的 find 替代。',
    repo: 'https://github.com/sharkdp/fd',
    install: { manager: 'winget', command: 'winget install --id sharkdp.fd -e' },
    detect: ['fd']
  },
  {
    id: 'ast-grep',
    name: 'ast-grep',
    category: 'search',
    summary: '按语法树搜索与改写代码（sg），正则做不到的结构化替换。',
    why: 'Rust 编写，成熟的结构化搜索/重写工具，适合批量改造。',
    repo: 'https://github.com/ast-grep/ast-grep',
    install: { manager: 'winget', command: 'winget install --id ast-grep.ast-grep -e' },
    detect: ['sg', 'ast-grep']
  },
  {
    id: 'fzf',
    name: 'fzf',
    category: 'search',
    summary: '模糊查找器：给任何列表加交互筛选，管道即可用。',
    why: 'Go 编写，十多年稳定生态，终端交互的通用积木。',
    repo: 'https://github.com/junegunn/fzf',
    install: { manager: 'winget', command: 'winget install --id junegunn.fzf -e' },
    detect: ['fzf']
  },
  {
    id: 'bat',
    name: 'bat',
    category: 'view',
    summary: '带语法高亮、行号与 Git 标记的 cat。',
    why: 'Rust 编写，输出即可读，也给其他工具当高亮分页器。',
    repo: 'https://github.com/sharkdp/bat',
    install: { manager: 'winget', command: 'winget install --id sharkdp.bat -e' },
    detect: ['bat']
  },
  {
    id: 'eza',
    name: 'eza',
    category: 'view',
    summary: '现代 ls：颜色、图标、Git 状态与树状视图。',
    why: 'Rust 编写，exa 的活跃继任者，Windows 下体验一致。',
    repo: 'https://github.com/eza-community/eza',
    install: { manager: 'winget', command: 'winget install --id eza-community.eza -e' },
    detect: ['eza']
  },
  {
    id: 'delta',
    name: 'delta',
    category: 'view',
    summary: '把 git diff 变成并排、语法高亮、可读的分页输出。',
    why: 'Rust 编写，git 生态里最成熟的 diff 美化器。',
    repo: 'https://github.com/dandavison/delta',
    install: { manager: 'winget', command: 'winget install --id dandavison.delta -e' },
    detect: ['delta']
  },
  {
    id: 'difftastic',
    name: 'difftastic',
    category: 'view',
    summary: '结构化 diff：按语法树对齐，改一行的真实影响一眼可见。',
    why: 'Rust 编写，理解语法而非文本行，复杂重构时最可靠。',
    repo: 'https://github.com/Wilfred/difftastic',
    install: { manager: 'winget', command: 'winget install --id Wilfred.difftastic -e' },
    detect: ['difft']
  },
  {
    id: 'bottom',
    name: 'bottom',
    category: 'view',
    summary: '终端系统监控：CPU / 内存 / 网络 / 进程一张图看全。',
    why: 'Rust 编写，btop 同级的成熟替代，Windows 支持完整。',
    repo: 'https://github.com/ClementTsang/bottom',
    install: { manager: 'winget', command: 'winget install --id Clement.bottom -e' },
    detect: ['btm']
  },
  {
    id: 'sd',
    name: 'sd',
    category: 'text',
    summary: '直观的查找替换：sd 旧 新 文件，不用记 sed 转义。',
    why: 'Rust 编写，语义就是「替换」，批量改文本不出幺蛾子。',
    repo: 'https://github.com/chmln/sd',
    install: { manager: 'winget', command: 'winget install --id chmln.sd -e' },
    detect: ['sd']
  },
  {
    id: 'jq',
    name: 'jq',
    category: 'text',
    summary: 'JSON 查询与整形的事实标准：过滤、映射、聚合都一行。',
    why: 'C 编写，十几年生态，任何脚本与文档都默认它存在。',
    repo: 'https://github.com/jqlang/jq',
    install: { manager: 'winget', command: 'winget install --id jqlang.jq -e' },
    detect: ['jq']
  },
  {
    id: 'xh',
    name: 'xh',
    category: 'text',
    summary: '友好的 HTTP 客户端：curl 的语法，彩色可读的输出。',
    why: 'Rust 编写，接口调试比 curl 直观，日常请求够快。',
    repo: 'https://github.com/ducaale/xh',
    install: { manager: 'winget', command: 'winget install --id ducaale.xh -e' },
    detect: ['xh']
  },
  {
    id: 'duf',
    name: 'duf',
    category: 'files',
    summary: '磁盘占用一眼看懂：彩色表格列出挂载点与剩余空间。',
    why: 'Go 编写，成熟稳定，替代记不住的 df 参数。',
    repo: 'https://github.com/muesli/duf',
    install: { manager: 'winget', command: 'winget install --id muesli.duf -e' },
    detect: ['duf']
  },
  {
    id: 'zoxide',
    name: 'zoxide',
    category: 'files',
    summary: '更聪明的 cd：记住常去目录，z 关键字直达。',
    why: 'Rust 编写，目录跳转的事实标准，几乎零学习成本。',
    repo: 'https://github.com/ajeetdsouza/zoxide',
    install: { manager: 'winget', command: 'winget install --id ajeetdsouza.zoxide -e' },
    detect: ['zoxide']
  },
  {
    id: 'yazi',
    name: 'yazi',
    category: 'files',
    summary: '终端文件管理器：预览、批量操作、键盘驱动。',
    why: 'Rust 编写，当前最成熟的 TUI 文件管理器之一。',
    repo: 'https://github.com/sxyazi/yazi',
    install: { manager: 'winget', command: 'winget install --id sxyazi.yazi -e' },
    detect: ['yazi']
  },
  {
    id: 'procs',
    name: 'procs',
    category: 'system',
    summary: '现代 ps：彩色输出、树状关系、可读的 CPU/内存列。',
    why: 'Rust 编写，进程排查比任务管理器命令直观。',
    repo: 'https://github.com/dalance/procs',
    install: { manager: 'winget', command: 'winget install --id dalance.procs -e' },
    detect: ['procs']
  },
  {
    id: 'hyperfine',
    name: 'hyperfine',
    category: 'system',
    summary: '命令行基准测试：多次运行取统计，带进度与对比。',
    why: 'Rust 编写，脚本性能验证的标准工具，结果可复现。',
    repo: 'https://github.com/sharkdp/hyperfine',
    install: { manager: 'winget', command: 'winget install --id sharkdp.hyperfine -e' },
    detect: ['hyperfine']
  },
  {
    id: 'tokei',
    name: 'tokei',
    category: 'system',
    summary: '按语言统计代码行数，极快且支持排除规则。',
    why: 'Rust 编写，并行统计，大仓库也秒出结果。',
    repo: 'https://github.com/XAMPPRocky/tokei',
    install: { manager: 'winget', command: 'winget install --id XAMPPRocky.Tokei -e' },
    detect: ['tokei']
  },
  {
    id: 'watchexec',
    name: 'watchexec',
    category: 'system',
    summary: '文件一变就执行命令：跑测试、重构建、重启服务。',
    why: 'Rust 编写，监听语义成熟，Windows 下可靠。',
    repo: 'https://github.com/watchexec/watchexec',
    install: { manager: 'winget', command: 'winget install --id watchexec.watchexec -e' },
    detect: ['watchexec']
  },
  {
    id: 'just',
    name: 'just',
    category: 'dev',
    summary: '项目任务运行器：justfile 里的短命令，替代散落的脚本。',
    why: 'Rust 编写，语法简单、错误信息友好，成熟度高。',
    repo: 'https://github.com/casey/just',
    install: { manager: 'winget', command: 'winget install --id Casey.Just -e' },
    detect: ['just']
  },
  {
    id: 'starship',
    name: 'starship',
    category: 'dev',
    summary: '极简跨 shell 提示符：Git、版本、耗时等信息一目了然。',
    why: 'Rust 编写，配置一份全 shell 通用，社区最活跃。',
    repo: 'https://github.com/starship/starship',
    install: { manager: 'winget', command: 'winget install --id Starship.Starship -e' },
    detect: ['starship']
  },
  {
    id: 'atuin',
    name: 'atuin',
    category: 'dev',
    summary: '可搜索、可统计的 shell 历史，本地 SQLite 存储。',
    why: 'Rust 编写，历史检索体验远超 Ctrl+R，默认本地。',
    repo: 'https://github.com/atuinsh/atuin',
    install: { manager: 'winget', command: 'winget install --id Atuinsh.Atuin -e' },
    detect: ['atuin']
  },
  {
    id: 'lazygit',
    name: 'lazygit',
    category: 'dev',
    summary: '终端里的 Git 面板：暂存、提交、分支、rebase 都用键盘。',
    why: 'Go 编写，多年稳定，复杂 Git 操作最省心的界面。',
    repo: 'https://github.com/jesseduffield/lazygit',
    install: { manager: 'winget', command: 'winget install --id JesseDuffield.lazygit -e' },
    detect: ['lazygit']
  },
  {
    id: 'uv',
    name: 'uv / uvx',
    category: 'runtime',
    summary: 'Python 包与工具启动器：uvx 直接跑 Python 系 MCP 服务。',
    why: 'Rust 编写、极快；Cherry 等客户端的同款托管运行时。',
    repo: 'https://github.com/astral-sh/uv',
    install: { manager: 'winget', command: 'winget install --id astral-sh.uv -e' },
    detect: ['uv', 'uvx'],
    runtime: {
      releaseApi: 'https://api.github.com/repos/astral-sh/uv/releases/latest',
      tagPrefix: '',
      assetUrl: (version) =>
        `https://github.com/astral-sh/uv/releases/download/${version}/uv-x86_64-pc-windows-msvc.zip`,
      binaries: ['uv.exe', 'uvx.exe'],
      fallbackVersion: '0.13.7',
      mirrorAsset: async (version) => {
        // GitHub 在国内常不可达；uv 官方在 PyPI 发 wheel（内含 uv.exe/uvx.exe），走阿里云镜像
        const res = await fetch('https://mirrors.aliyun.com/pypi/simple/uv/', {
          signal: AbortSignal.timeout(8000)
        })
        if (!res.ok) return null
        const html = await res.text()
        const match = html.match(
          new RegExp(
            'href="([^"]*uv-' + version.replace(/[.]/g, '.') + '-py3-none-win_amd64.whl[^"]*)"'
          )
        )
        if (!match) return null
        const [pathPart, hashPart] = match[1].split('#')
        return {
          url: new URL(pathPart, 'https://mirrors.aliyun.com/pypi/simple/uv/').toString(),
          ...(hashPart?.startsWith('sha256=') ? { sha256: hashPart.slice(7) } : {})
        }
      },
      wingetId: 'astral-sh.uv'
    }
  },
  {
    id: 'bun',
    name: 'bun / bunx',
    category: 'runtime',
    summary: 'JS/TS 运行时与包管理器：bunx 跑 npm 系 MCP 服务，比 npx 快。',
    why: 'Zig 编写、启动极快；Cherry 托管的 JS 运行时同款。',
    repo: 'https://github.com/oven-sh/bun',
    install: { manager: 'winget', command: 'winget install --id Oven-sh.Bun -e' },
    detect: ['bun', 'bunx'],
    runtime: {
      releaseApi: 'https://api.github.com/repos/oven-sh/bun/releases/latest',
      tagPrefix: 'bun-v',
      assetUrl: (version) =>
        `https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-windows-x64.zip`,
      mirrorAsset: (version) => ({
        url: `https://registry.npmmirror.com/-/binary/bun/bun-v${version}/bun-windows-x64.zip`
      }),
      fallbackVersion: '1.4.4',
      binaries: ['bun.exe'],
      wingetId: 'Oven-sh.Bun'
    }
  },
  {
    id: 'node',
    name: 'node / npx',
    category: 'runtime',
    summary: 'Node.js 运行时：npx 跑 npm 系 MCP 服务的传统路径。',
    why: '生态最全；已有系统 Node 时可直接选系统源，零下载。',
    repo: 'https://github.com/nodejs/node',
    install: { manager: 'winget', command: 'winget install --id OpenJS.NodeJS -e' },
    detect: ['node', 'npx'],
    runtime: {
      releaseApi: 'https://nodejs.org/dist/index.json',
      tagPrefix: '',
      assetUrl: (version) => `https://nodejs.org/dist/v${version}/node-v${version}-win-x64.zip`,
      mirrorAsset: (version) => ({
        url: `https://registry.npmmirror.com/-/binary/node/v${version}/node-v${version}-win-x64.zip`
      }),
      binaries: ['node.exe', 'npm.cmd', 'npx.cmd'],
      wingetId: 'OpenJS.NodeJS'
    }
  }
]

/** MCP 服务推荐：端点与鉴权方式均经真实连接实测；添加后仍走既有信任/登录流程。 */
export interface McpRecommendation {
  id: string
  name: string
  summary: string
  why: string
  url: string
  auth: 'none' | 'headers' | 'oauth'
  authNote: string
  docs: string
}

export const MCP_RECOMMENDATIONS: McpRecommendation[] = [
  {
    id: 'deepwiki',
    name: 'DeepWiki',
    summary: '问答式读取 GitHub 仓库的文档与代码结构。',
    why: '无鉴权即可用；已实测公网远程工具调用成功。',
    url: 'https://mcp.deepwiki.com/mcp',
    auth: 'none',
    authNote: '无鉴权',
    docs: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp'
  },
  {
    id: 'context7',
    name: 'Context7',
    summary: '把库的最新官方文档拉进上下文，减少过时 API 幻觉。',
    why: '带 Key 实测 resolve-library-id / query-docs 返回真实库结果。',
    url: 'https://mcp.context7.com/mcp',
    auth: 'headers',
    authNote: '需 API Key',
    docs: 'https://context7.com/docs'
  },
  {
    id: 'notion',
    name: 'Notion',
    summary: '读写 Notion 页面与数据库，把笔记库接进 Agent。',
    why: 'OAuth 真登录实测 69 个工具，重启后仍保持连接。',
    url: 'https://mcp.notion.com/mcp',
    auth: 'oauth',
    authNote: 'OAuth 登录',
    docs: 'https://developers.notion.com/reference/mcp'
  }
]

/** 技能库推荐：标准 Claude 插件市场仓库，走现有「插件源 → 市场 → 安装」链路。 */
export interface SkillSourceRecommendation {
  id: string
  name: string
  summary: string
  why: string
  url: string
  highlights: string[]
  docs: string
}

export const SKILL_SOURCE_RECOMMENDATIONS: SkillSourceRecommendation[] = [
  {
    id: 'anthropics-skills',
    name: 'Anthropic 官方技能库',
    summary: '官方维护的技能市场：文档处理、设计、API 指南等。',
    why: '标准 .claude-plugin 市场格式，直接复用插件源 → 市场 → 安装与信任流程。',
    url: 'https://github.com/anthropics/skills',
    highlights: ['docx', 'pdf', 'pptx', 'xlsx', 'frontend-design'],
    docs: 'https://github.com/anthropics/skills'
  }
]
