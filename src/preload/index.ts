import { contextBridge, ipcRenderer } from 'electron'
import {
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
    listModels: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerModels, input)
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
  notes: {
    bootstrap: (notes) => ipcRenderer.invoke(IPC_CHANNELS.notesBootstrap, notes),
    page: (offset, limit) => ipcRenderer.invoke(IPC_CHANNELS.notesPage, offset, limit),
    search: (query, limit) => ipcRenderer.invoke(IPC_CHANNELS.notesSearch, query, limit),
    create: (text, tag) => ipcRenderer.invoke(IPC_CHANNELS.notesCreate, text, tag),
    togglePin: (id) => ipcRenderer.invoke(IPC_CHANNELS.notesTogglePin, id),
    update: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.notesUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC_CHANNELS.notesRemove, id),
    links: (id) => ipcRenderer.invoke(IPC_CHANNELS.notesLinks, id),
    titles: (query, limit, excludeId) =>
      ipcRenderer.invoke(IPC_CHANNELS.notesTitles, query, limit, excludeId)
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
    review: (id, rating) => ipcRenderer.invoke(IPC_CHANNELS.learningReview, id, rating),
    createMany: (drafts) => ipcRenderer.invoke(IPC_CHANNELS.learningCreateMany, drafts),
    exportCards: (subject) => ipcRenderer.invoke(IPC_CHANNELS.learningExport, subject),
    reviewHistory: (days) => ipcRenderer.invoke(IPC_CHANNELS.learningReviewHistory, days)
  },
  habits: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.habitsList),
    bootstrap: (habits) => ipcRenderer.invoke(IPC_CHANNELS.habitsBootstrap, habits),
    setCheckin: (id, day, done) => ipcRenderer.invoke(IPC_CHANNELS.habitsSetCheckin, id, day, done)
  },
  agent: {
    send: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentSend, input),
    cancel: (runId) => ipcRenderer.invoke(IPC_CHANNELS.agentCancel, runId),
    respondPermission: (response) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentPermissionResponse, response),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AgentEventEnvelope) =>
        listener(payload)
      ipcRenderer.on(IPC_CHANNELS.agentEvent, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.agentEvent, handler)
    },
    threads: () => ipcRenderer.invoke(IPC_CHANNELS.agentThreads),
    createSession: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentCreateSession, input),
    updateSession: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.agentUpdateSession, id, patch),
    saveMessage: (message) => ipcRenderer.invoke(IPC_CHANNELS.agentSaveMessage, message),
    pickWorkspace: (current) => ipcRenderer.invoke(IPC_CHANNELS.agentPickWorkspace, current),
    workspaceTree: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.agentWorkspaceTree, sessionId),
    readWorkspaceFile: (sessionId, path) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentWorkspaceFile, sessionId, path),
    openWorkspace: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.agentOpenWorkspace, sessionId),
    presets: () => ipcRenderer.invoke(IPC_CHANNELS.agentPresets),
    savePreset: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentSavePreset, input),
    removePreset: (id) => ipcRenderer.invoke(IPC_CHANNELS.agentRemovePreset, id),
    usage: (days) => ipcRenderer.invoke(IPC_CHANNELS.agentUsage, days),
    discoverSessions: () => ipcRenderer.invoke(IPC_CHANNELS.agentDiscoverSessions),
    importSession: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentImportSession, input),
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
    environment: (force) => ipcRenderer.invoke(IPC_CHANNELS.capabilityEnvironment, force),
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
      setToolPolicy: (id, toolName, approval) =>
        ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpSetToolPolicy, id, toolName, approval),
      importConfig: (text) => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpImport, text),
      exportConfig: () => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpExport),
      checkUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpCheckUpdates),
      applyUpdate: (id) => ipcRenderer.invoke(IPC_CHANNELS.capabilityMcpApplyUpdate, id)
    }
  },
  audit: {
    recent: (limit, domain) => ipcRenderer.invoke(IPC_CHANNELS.auditRecent, limit, domain)
  },
  app: {
    setTheme: (theme) => ipcRenderer.invoke(IPC_CHANNELS.appSetTheme, theme),
    backupNow: () => ipcRenderer.invoke(IPC_CHANNELS.appBackupNow),
    info: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo)
  }
}

contextBridge.exposeInMainWorld('ws', Object.freeze(api))
