import { contextBridge, ipcRenderer } from 'electron'
import {
  type AgentAttention,
  type AgentEventEnvelope,
  IPC_CHANNELS,
  type TaskScheduleChange,
  type WsApi
} from '../shared/ipc'

const api: WsApi = {
  provider: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.providerList),
    save: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerSave, input),
    setActive: (target, id) => ipcRenderer.invoke(IPC_CHANNELS.providerSetActive, target, id),
    test: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerTest, input),
    listModels: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerModels, input),
    fallbackFor: (target) => ipcRenderer.invoke(IPC_CHANNELS.providerFallbackFor, target)
  },
  tasks: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.tasksList),
    bootstrap: (tasks) => ipcRenderer.invoke(IPC_CHANNELS.tasksBootstrap, tasks),
    setDone: (id, done) => ipcRenderer.invoke(IPC_CHANNELS.tasksSetDone, id, done),
    applySchedule: (changes: TaskScheduleChange[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.tasksApplySchedule, changes),
    create: (draft) => ipcRenderer.invoke(IPC_CHANNELS.tasksCreate, draft),
    update: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.tasksUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC_CHANNELS.tasksRemove, id),
    restore: (id) => ipcRenderer.invoke(IPC_CHANNELS.tasksRestore, id),
    renameList: (from, to) => ipcRenderer.invoke(IPC_CHANNELS.tasksRenameList, from, to),
    onChanged: (callback) => {
      const handler = () => callback()
      ipcRenderer.on(IPC_CHANNELS.tasksChanged, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.tasksChanged, handler)
      }
    }
  },
  reminders: {
    muted: (day) => ipcRenderer.invoke(IPC_CHANNELS.remindersMuted, day),
    mute: (taskId, day) => ipcRenderer.invoke(IPC_CHANNELS.remindersMute, taskId, day),
    unmute: (taskId, day) => ipcRenderer.invoke(IPC_CHANNELS.remindersUnmute, taskId, day),
    unmuteDay: (day) => ipcRenderer.invoke(IPC_CHANNELS.remindersUnmuteDay, day)
  },
  notes: {
    bootstrap: (notes) => ipcRenderer.invoke(IPC_CHANNELS.notesBootstrap, notes),
    page: (offset, limit, tag) => ipcRenderer.invoke(IPC_CHANNELS.notesPage, offset, limit, tag),
    search: (query, limit, tag) => ipcRenderer.invoke(IPC_CHANNELS.notesSearch, query, limit, tag),
    tags: () => ipcRenderer.invoke(IPC_CHANNELS.notesTags),
    create: (text, tag) => ipcRenderer.invoke(IPC_CHANNELS.notesCreate, text, tag),
    togglePin: (id) => ipcRenderer.invoke(IPC_CHANNELS.notesTogglePin, id),
    update: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.notesUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC_CHANNELS.notesRemove, id),
    links: (id) => ipcRenderer.invoke(IPC_CHANNELS.notesLinks, id),
    titles: (query, limit, excludeId) =>
      ipcRenderer.invoke(IPC_CHANNELS.notesTitles, query, limit, excludeId),
    get: (id) => ipcRenderer.invoke(IPC_CHANNELS.notesGet, id),
    graph: () => ipcRenderer.invoke(IPC_CHANNELS.notesGraph)
  },
  capture: {
    open: () => ipcRenderer.invoke(IPC_CHANNELS.captureOpen),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.captureClose),
    create: (draft) => ipcRenderer.invoke(IPC_CHANNELS.captureCreate, draft)
  },
  learning: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.learningList),
    bootstrap: (items) => ipcRenderer.invoke(IPC_CHANNELS.learningBootstrap, items),
    create: (draft) => ipcRenderer.invoke(IPC_CHANNELS.learningCreate, draft),
    update: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.learningUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC_CHANNELS.learningRemove, id),
    review: (id, rating) => ipcRenderer.invoke(IPC_CHANNELS.learningReview, id, rating),
    createMany: (drafts) => ipcRenderer.invoke(IPC_CHANNELS.learningCreateMany, drafts),
    exportCards: (subject) => ipcRenderer.invoke(IPC_CHANNELS.learningExport, subject),
    reviewHistory: (days) => ipcRenderer.invoke(IPC_CHANNELS.learningReviewHistory, days),
    newIntroduced: (day) => ipcRenderer.invoke(IPC_CHANNELS.learningNewIntroduced, day)
  },
  habits: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.habitsList),
    bootstrap: (habits) => ipcRenderer.invoke(IPC_CHANNELS.habitsBootstrap, habits),
    setCheckin: (id, day, done) => ipcRenderer.invoke(IPC_CHANNELS.habitsSetCheckin, id, day, done),
    create: (name) => ipcRenderer.invoke(IPC_CHANNELS.habitsCreate, name),
    rename: (id, name) => ipcRenderer.invoke(IPC_CHANNELS.habitsRename, id, name),
    remove: (id) => ipcRenderer.invoke(IPC_CHANNELS.habitsRemove, id)
  },
  agent: {
    send: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentSend, input),
    cancel: (runId) => ipcRenderer.invoke(IPC_CHANNELS.agentCancel, runId),
    respondPermission: (response) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentPermissionResponse, response),
    respondQuestion: (response) => ipcRenderer.invoke(IPC_CHANNELS.agentQuestionResponse, response),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AgentEventEnvelope) =>
        listener(payload)
      ipcRenderer.on(IPC_CHANNELS.agentEvent, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.agentEvent, handler)
    },
    onAttention: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AgentAttention) =>
        listener(payload)
      ipcRenderer.on(IPC_CHANNELS.agentAttention, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.agentAttention, handler)
    },
    threads: () => ipcRenderer.invoke(IPC_CHANNELS.agentThreads),
    sessions: () => ipcRenderer.invoke(IPC_CHANNELS.agentSessions),
    thread: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.agentThread, sessionId),
    searchSessions: (query) => ipcRenderer.invoke(IPC_CHANNELS.agentSearchSessions, query),
    exportSession: (id) => ipcRenderer.invoke(IPC_CHANNELS.agentExportSession, id),
    createSession: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentCreateSession, input),
    updateSession: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.agentUpdateSession, id, patch),
    deleteSession: (id) => ipcRenderer.invoke(IPC_CHANNELS.agentDeleteSession, id),
    saveMessage: (message) => ipcRenderer.invoke(IPC_CHANNELS.agentSaveMessage, message),
    pickWorkspace: (current) => ipcRenderer.invoke(IPC_CHANNELS.agentPickWorkspace, current),
    workspaceTree: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.agentWorkspaceTree, sessionId),
    readWorkspaceFile: (sessionId, path) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentWorkspaceFile, sessionId, path),
    openWorkspace: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.agentOpenWorkspace, sessionId),
    presets: () => ipcRenderer.invoke(IPC_CHANNELS.agentPresets),
    checkpoints: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.agentCheckpoints, sessionId),
    rollback: (checkpointId) => ipcRenderer.invoke(IPC_CHANNELS.agentRollback, checkpointId),
    saveImage: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentSaveImage, input),
    imageData: (image) => ipcRenderer.invoke(IPC_CHANNELS.agentImageData, image),
    discardImage: (image) => ipcRenderer.invoke(IPC_CHANNELS.agentDiscardImage, image),
    savePreset: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentSavePreset, input),
    removePreset: (id) => ipcRenderer.invoke(IPC_CHANNELS.agentRemovePreset, id),
    usage: (days) => ipcRenderer.invoke(IPC_CHANNELS.agentUsage, days),
    discoverSessions: () => ipcRenderer.invoke(IPC_CHANNELS.agentDiscoverSessions),
    importSession: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentImportSession, input),
    forkSession: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentForkSession, input),
    createTeam: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentTeamCreate, input),
    listTeams: () => ipcRenderer.invoke(IPC_CHANNELS.agentTeamList),
    postTeamNote: (teamId, sessionId, role, text) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentTeamPost, { teamId, sessionId, role, text }),
    teamNotes: (teamId) => ipcRenderer.invoke(IPC_CHANNELS.agentTeamNotes, teamId),
    getLocalModel: () => ipcRenderer.invoke(IPC_CHANNELS.agentLocalModelGet),
    setLocalModel: (config) => ipcRenderer.invoke(IPC_CHANNELS.agentLocalModelSet, config),
    evolveExpert: (sessionId, messageId) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentEvolveExpert, { sessionId, messageId }),
    approvalRules: () => ipcRenderer.invoke(IPC_CHANNELS.agentApprovalRules),
    removeApprovalRule: (id) => ipcRenderer.invoke(IPC_CHANNELS.agentRemoveApprovalRule, id)
  },
  mcp: {
    policy: () => ipcRenderer.invoke(IPC_CHANNELS.mcpPolicyList),
    setPolicy: (domain, mode) => ipcRenderer.invoke(IPC_CHANNELS.mcpPolicySet, domain, mode),
    respondPermission: (response) =>
      ipcRenderer.invoke(IPC_CHANNELS.mcpPermissionResponse, response),
    onPermission: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        request: Parameters<typeof listener>[0]
      ) => listener(request)
      ipcRenderer.on(IPC_CHANNELS.mcpPermission, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.mcpPermission, handler)
    },
    onChanged: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        domains: Parameters<typeof listener>[0]
      ) => listener(domains)
      ipcRenderer.on(IPC_CHANNELS.mcpChanged, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.mcpChanged, handler)
    }
  },
  capability: {
    builtinTools: () => ipcRenderer.invoke(IPC_CHANNELS.capabilityBuiltinTools),
    setBuiltinTool: (name, enabled) =>
      ipcRenderer.invoke(IPC_CHANNELS.capabilityBuiltinToolSet, name, enabled),
    toolSurface: () => ipcRenderer.invoke(IPC_CHANNELS.capabilityToolSurface),
    setNativeTool: (agent, id, enabled) =>
      ipcRenderer.invoke(IPC_CHANNELS.capabilityToolSet, agent, id, enabled),
    moveTool: (agent, key, direction) =>
      ipcRenderer.invoke(IPC_CHANNELS.capabilityToolMove, agent, key, direction),
    setPreferredTool: (agent, key, preferred) =>
      ipcRenderer.invoke(IPC_CHANNELS.capabilityToolPrefer, agent, key, preferred),
    setToolNote: (agent, key, note) =>
      ipcRenderer.invoke(IPC_CHANNELS.capabilityToolNote, agent, key, note),
    pluginSources: () => ipcRenderer.invoke(IPC_CHANNELS.capabilityPluginSources),
    addPluginSource: (input) => ipcRenderer.invoke(IPC_CHANNELS.capabilityPluginSourceAdd, input),
    refreshPluginSource: (id) => ipcRenderer.invoke(IPC_CHANNELS.capabilityPluginSourceRefresh, id),
    removePluginSource: (id) => ipcRenderer.invoke(IPC_CHANNELS.capabilityPluginSourceRemove, id),
    scanLocalPlugins: () => ipcRenderer.invoke(IPC_CHANNELS.capabilityPluginScanLocal),
    installedPlugins: () => ipcRenderer.invoke(IPC_CHANNELS.capabilityPluginInstalled),
    importLocalPlugins: (input) => ipcRenderer.invoke(IPC_CHANNELS.capabilityPluginImport, input),
    setPluginEnabled: (input) => ipcRenderer.invoke(IPC_CHANNELS.capabilityPluginSetEnabled, input),
    removePlugin: (input) => ipcRenderer.invoke(IPC_CHANNELS.capabilityPluginRemove, input),
    checkUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.capabilityUpdatesCheck),
    applyUpdates: (candidates) =>
      ipcRenderer.invoke(IPC_CHANNELS.capabilityUpdatesApply, candidates),
    onUpdateAvailable: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, list: Parameters<typeof listener>[0]) =>
        listener(list)
      ipcRenderer.on(IPC_CHANNELS.capabilityUpdateAvailable, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.capabilityUpdateAvailable, handler)
    },
    environment: (force) => ipcRenderer.invoke(IPC_CHANNELS.capabilityEnvironment, force),
    cliRecommend: () => ipcRenderer.invoke(IPC_CHANNELS.capabilityCliRecommend),
    cliRuntimes: () => ipcRenderer.invoke(IPC_CHANNELS.capabilityCliRuntimes),
    setCliSource: (id, source) =>
      ipcRenderer.invoke(IPC_CHANNELS.capabilityCliSetSource, id, source),
    installCliRuntime: (id) => ipcRenderer.invoke(IPC_CHANNELS.capabilityCliInstall, id),
    uninstallCliRuntime: (id) => ipcRenderer.invoke(IPC_CHANNELS.capabilityCliUninstall, id),
    cliRuntimeUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.capabilityCliUpdates),
    skills: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.capabilitySkillsList),
      importLocal: () => ipcRenderer.invoke(IPC_CHANNELS.capabilitySkillsImportLocal),
      inspect: (pluginId) => ipcRenderer.invoke(IPC_CHANNELS.capabilitySkillsInspect, pluginId),
      openFolder: (pluginId) =>
        ipcRenderer.invoke(IPC_CHANNELS.capabilitySkillsOpenFolder, pluginId),
      market: (force) => ipcRenderer.invoke(IPC_CHANNELS.capabilitySkillsMarket, force),
      install: (pluginId) => ipcRenderer.invoke(IPC_CHANNELS.capabilitySkillsInstall, pluginId),
      update: (pluginId) => ipcRenderer.invoke(IPC_CHANNELS.capabilitySkillsUpdate, pluginId),
      remove: (pluginId) => ipcRenderer.invoke(IPC_CHANNELS.capabilitySkillsRemove, pluginId),
      setEnabled: (pluginId, enabled, trust) =>
        ipcRenderer.invoke(IPC_CHANNELS.capabilitySkillsSetEnabled, pluginId, enabled, trust)
    },
    mcp: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpList),
      catalog: () => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpCatalog),
      add: (input) => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpAdd, input),
      update: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpUpdate, id, input),
      remove: (id) => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpRemove, id),
      setEnabled: (id, enabled, trust) =>
        ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpSetEnabled, id, enabled, trust),
      test: (id) => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpTest, id),
      login: (id) => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpOAuthLogin, id),
      logout: (id) => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpOAuthLogout, id),
      setToolPolicy: (id, toolName, approval) =>
        ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpSetToolPolicy, id, toolName, approval),
      importConfig: (text) => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpImport, text),
      exportConfig: () => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpExport),
      checkUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpCheckUpdates),
      applyUpdate: (id) => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpApplyUpdate, id)
    }
  },
  experts: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.expertsList),
    save: (input) => ipcRenderer.invoke(IPC_CHANNELS.expertsSave, input),
    remove: (id) => ipcRenderer.invoke(IPC_CHANNELS.expertsRemove, id),
    importMarkdown: (text) => ipcRenderer.invoke(IPC_CHANNELS.expertsImport, text),
    export: (id) => ipcRenderer.invoke(IPC_CHANNELS.expertsExport, id),
    activate: (agent, id) => ipcRenderer.invoke(IPC_CHANNELS.expertsActivate, { agent, id }),
    market: {
      sources: () => ipcRenderer.invoke(IPC_CHANNELS.expertMarketSources),
      addSource: (input) => ipcRenderer.invoke(IPC_CHANNELS.expertMarketAddSource, input),
      removeSource: (id) => ipcRenderer.invoke(IPC_CHANNELS.expertMarketRemoveSource, id),
      refresh: (id) => ipcRenderer.invoke(IPC_CHANNELS.expertMarketRefresh, id),
      list: () => ipcRenderer.invoke(IPC_CHANNELS.expertMarketList),
      import: (sourceId, relPath) =>
        ipcRenderer.invoke(IPC_CHANNELS.expertMarketImport, { sourceId, relPath })
    }
  },
  audit: {
    recent: (limit, domain) => ipcRenderer.invoke(IPC_CHANNELS.auditRecent, limit, domain)
  },
  app: {
    setTheme: (theme) => ipcRenderer.invoke(IPC_CHANNELS.appSetTheme, theme),
    windowMinimize: () => ipcRenderer.invoke(IPC_CHANNELS.appWindowMinimize),
    windowToggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.appWindowToggleMaximize),
    windowClose: () => ipcRenderer.invoke(IPC_CHANNELS.appWindowClose),
    windowState: () => ipcRenderer.invoke(IPC_CHANNELS.appWindowGetState),
    onWindowState: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) =>
        listener(state)
      ipcRenderer.on(IPC_CHANNELS.appWindowState, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.appWindowState, handler)
    },
    backupNow: () => ipcRenderer.invoke(IPC_CHANNELS.appBackupNow),
    listBackups: () => ipcRenderer.invoke(IPC_CHANNELS.appBackupList),
    restoreBackup: (name) => ipcRenderer.invoke(IPC_CHANNELS.appRestoreBackup, name),
    restoreStatus: () => ipcRenderer.invoke(IPC_CHANNELS.appRestoreStatus),
    relaunch: () => ipcRenderer.invoke(IPC_CHANNELS.appRelaunch),
    info: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo),
    storage: () => ipcRenderer.invoke(IPC_CHANNELS.appStorage),
    pickStorage: () => ipcRenderer.invoke(IPC_CHANNELS.appStoragePick),
    cancelStorage: () => ipcRenderer.invoke(IPC_CHANNELS.appStorageCancel)
  }
}

contextBridge.exposeInMainWorld('ws', Object.freeze(api))
