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
    setActive: (target, id) => ipcRenderer.invoke(IPC_CHANNELS.providerSetActive, target, id)
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
    saveMessage: (message) => ipcRenderer.invoke(IPC_CHANNELS.agentSaveMessage, message)
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
