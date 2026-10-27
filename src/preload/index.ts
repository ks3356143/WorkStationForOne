import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type TaskScheduleChange, type WsApi } from '../shared/ipc'

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
    togglePin: (id) => ipcRenderer.invoke(IPC_CHANNELS.notesTogglePin, id)
  },
  capture: {
    open: () => ipcRenderer.invoke(IPC_CHANNELS.captureOpen),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.captureClose),
    create: (draft) => ipcRenderer.invoke(IPC_CHANNELS.captureCreate, draft)
  },
  app: {
    setTheme: (theme) => ipcRenderer.invoke(IPC_CHANNELS.appSetTheme, theme)
  }
}

contextBridge.exposeInMainWorld('ws', Object.freeze(api))
