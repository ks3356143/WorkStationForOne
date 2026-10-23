import { contextBridge, ipcRenderer } from 'electron'
import {
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
      ipcRenderer.invoke(IPC_CHANNELS.tasksApplySchedule, changes)
  },
  notes: {
    bootstrap: (notes) => ipcRenderer.invoke(IPC_CHANNELS.notesBootstrap, notes),
    page: (offset, limit) => ipcRenderer.invoke(IPC_CHANNELS.notesPage, offset, limit),
    search: (query, limit) => ipcRenderer.invoke(IPC_CHANNELS.notesSearch, query, limit),
    create: (text, tag) => ipcRenderer.invoke(IPC_CHANNELS.notesCreate, text, tag),
    togglePin: (id) => ipcRenderer.invoke(IPC_CHANNELS.notesTogglePin, id)
  }
}

contextBridge.exposeInMainWorld('ws', Object.freeze(api))
