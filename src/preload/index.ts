import { contextBridge, ipcRenderer } from 'electron'
import {
  type AgentEventEnvelope,
  IPC_CHANNELS,
  type TaskScheduleChange,
  type WsApi
} from '../shared/ipc'

const api: WsApi = {
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
    remove: (id) => ipcRenderer.invoke(IPC_CHANNELS.notesRemove, id)
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
    review: (id, rating) => ipcRenderer.invoke(IPC_CHANNELS.learningReview, id, rating)
  },
  habits: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.habitsList),
    bootstrap: (habits) => ipcRenderer.invoke(IPC_CHANNELS.habitsBootstrap, habits),
    setCheckin: (id, day, done) => ipcRenderer.invoke(IPC_CHANNELS.habitsSetCheckin, id, day, done)
  },
  agent: {
    send: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentSend, input),
    cancel: (runId) => ipcRenderer.invoke(IPC_CHANNELS.agentCancel, runId),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AgentEventEnvelope) =>
        listener(payload)
      ipcRenderer.on(IPC_CHANNELS.agentEvent, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.agentEvent, handler)
    }
  },
  app: {
    setTheme: (theme) => ipcRenderer.invoke(IPC_CHANNELS.appSetTheme, theme),
    backupNow: () => ipcRenderer.invoke(IPC_CHANNELS.appBackupNow),
    info: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo)
  }
}

contextBridge.exposeInMainWorld('ws', Object.freeze(api))
