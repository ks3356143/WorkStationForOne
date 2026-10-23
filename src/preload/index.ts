import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type TaskScheduleChange, type WsApi } from '../shared/ipc'

const api: WsApi = {
  tasks: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.tasksList),
    bootstrap: (tasks) => ipcRenderer.invoke(IPC_CHANNELS.tasksBootstrap, tasks),
    setDone: (id, done) => ipcRenderer.invoke(IPC_CHANNELS.tasksSetDone, id, done),
    applySchedule: (changes: TaskScheduleChange[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.tasksApplySchedule, changes)
  }
}

contextBridge.exposeInMainWorld('ws', Object.freeze(api))
