import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  AnimatePresence,
  LazyMotion,
  MotionConfig,
  domAnimation,
  m,
  useReducedMotion
} from 'motion/react'
import { AgentDock } from './components/agent/AgentDock'
import { BootOverlay } from './components/BootOverlay'
import { CommandPalette } from './components/CommandPalette'
import { FocusOverlay } from './components/FocusOverlay'
import { LearningWorkspace } from './components/learning/LearningWorkspace'
import { NotesView } from './components/NotesView'
import { QuickNoteModal } from './components/QuickNoteModal'
import { SessionRail } from './components/SessionRail'
import { ShortcutSheet } from './components/ShortcutSheet'
import { StatusBar } from './components/StatusBar'
import { TasksView } from './components/tasks/TasksView'
import { TodayDashboard } from './components/TodayDashboard'
import { TopBar } from './components/TopBar'
import { WorkspaceNav } from './components/WorkspaceNav'
import { useWorkstation } from './store/useWorkstation'
import { DURATION, EASE_OUT } from './lib/motion'
import { hydrateTasks, refreshTasks } from './lib/persistence'
import { hydrateNotes } from './lib/notes-persistence'
import { hydrateLearning } from './lib/learning-persistence'
import { isTypingTarget } from './lib/shortcuts'
import { useAgentRun } from './lib/useAgentRun'

export default function App() {
  const motionOn = useWorkstation((state) => state.motionOn)
  const activeView = useWorkstation((state) => state.activeView)
  const focus = useWorkstation((state) => state.focus)
  const quickNoteOpen = useWorkstation((state) => state.quickNoteOpen)
  const openQuickNote = useWorkstation((state) => state.openQuickNote)
  const closeQuickNote = useWorkstation((state) => state.closeQuickNote)
  const closeFocus = useWorkstation((state) => state.closeFocus)
  const composeTask = useWorkstation((state) => state.composeTask)

  const [booting, setBooting] = useState(true)
  const [commandOpen, setCommandOpen] = useState(false)
  const [paletteSeq, setPaletteSeq] = useState(0)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const shortcutsTriggerRef = useRef<HTMLElement | null>(null)
  const [notice, setNotice] = useState<{
    id: number
    text: string
    action?: { label: string; run: () => void }
    duration: number
  } | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const noticeSeq = useRef(0)
  const paletteTriggerRef = useRef<HTMLElement | null>(null)
  const reducedMotion = useReducedMotion()

  useAgentRun()

  const notify = useCallback(
    (text: string, action?: { label: string; run: () => void }, duration = 2400) => {
      noticeSeq.current += 1
      setNotice({ id: noticeSeq.current, text, action, duration })
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
      noticeTimer.current = window.setTimeout(() => setNotice(null), duration)
    },
    []
  )

  const persistenceError = useWorkstation((state) => state.persistenceError)
  const clearPersistenceError = useWorkstation((state) => state.clearPersistenceError)

  useEffect(() => {
    if (!persistenceError) return
    notify(persistenceError, undefined, 4000)
    clearPersistenceError()
  }, [persistenceError, clearPersistenceError, notify])

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), reducedMotion ? 420 : 1250)
    return () => window.clearTimeout(timer)
  }, [reducedMotion])

  useEffect(() => {
    void hydrateTasks()
    void hydrateNotes()
    void hydrateLearning()
  }, [])

  useEffect(() => {
    const unsubscribe = window.ws?.tasks?.onChanged?.(() => {
      void refreshTasks()
    })
    return () => unsubscribe?.()
  }, [])

  useEffect(() => {
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    }
  }, [])

  const openPalette = useCallback(() => {
    if (focus || quickNoteOpen || commandOpen) return
    paletteTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPaletteSeq((seq) => seq + 1)
    setCommandOpen(true)
  }, [commandOpen, focus, quickNoteOpen])

  const closePalette = useCallback(() => {
    setCommandOpen(false)
    const trigger = paletteTriggerRef.current
    paletteTriggerRef.current = null
    trigger?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (booting) {
        setBooting(false)
        return
      }
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (focus || quickNoteOpen) return
        if (commandOpen) closePalette()
        else openPalette()
        return
      }
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        if (!focus && !commandOpen && !quickNoteOpen) {
          if (event.shiftKey) composeTask()
          else openQuickNote()
        }
        return
      }
      if (event.key === '?' && !mod && !event.altKey) {
        // 输入框里的问号是正文，不能抢走
        if (isTypingTarget(event.target)) return
        if (commandOpen || quickNoteOpen || focus) return
        if (shortcutsOpen) return
        event.preventDefault()
        shortcutsTriggerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
        setShortcutsOpen(true)
        return
      }
      if (event.key === 'Escape') {
        if (event.isComposing || event.keyCode === 229) return
        if (shortcutsOpen) setShortcutsOpen(false)
        else if (commandOpen) closePalette()
        else if (quickNoteOpen) closeQuickNote()
        else if (focus) closeFocus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    booting,
    closeFocus,
    closePalette,
    closeQuickNote,
    commandOpen,
    composeTask,
    focus,
    openPalette,
    openQuickNote,
    quickNoteOpen,
    shortcutsOpen
  ])

  return (
    <MotionConfig reducedMotion={motionOn ? 'user' : 'always'}>
      <LazyMotion features={domAnimation} strict>
        <div
          className={`w1${motionOn ? '' : ' motion-off'}${booting ? '' : ' is-booted'}${
            commandOpen ? ' palette-open' : ''
          }`}
        >
          <div className={`w1-scan${booting ? '' : ' run'}`} aria-hidden="true" />
          <div className="w1-ambient" aria-hidden="true" />
          <TopBar onCommand={openPalette} />
          <div className="w1-body">
            <WorkspaceNav notify={notify} />
            <main className="w1-stage">
              <div key={activeView} className="w1-view">
                {activeView === 'today' ? <TodayDashboard /> : null}
                {activeView === 'tasks' ? <TasksView notify={notify} /> : null}
                {activeView === 'agent' ? (
                  <section className="w1-workspace w1-agent" aria-label="Agent 工作区">
                    <SessionRail notify={notify} />
                    <AgentDock />
                  </section>
                ) : null}
                {activeView === 'notes' ? <NotesView /> : null}
                {activeView === 'learning' ? <LearningWorkspace /> : null}
              </div>
            </main>
          </div>
          <StatusBar notify={notify} onShortcuts={() => setShortcutsOpen(true)} />

          <AnimatePresence>
            {booting ? <BootOverlay onSkip={() => setBooting(false)} /> : null}
          </AnimatePresence>

          <AnimatePresence>
            {focus ? <FocusOverlay key={focus.label} focus={focus} onClose={closeFocus} /> : null}
          </AnimatePresence>

          <AnimatePresence>{quickNoteOpen ? <QuickNoteModal /> : null}</AnimatePresence>

          <AnimatePresence>
            {shortcutsOpen ? (
              <ShortcutSheet
                onClose={() => {
                  setShortcutsOpen(false)
                  shortcutsTriggerRef.current?.focus()
                }}
              />
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {commandOpen ? (
              <CommandPalette
                key={`palette-${paletteSeq}`}
                notify={notify}
                onClose={closePalette}
                onShortcuts={() => {
                  // 先收起面板（焦点回到触发元素），速查表再记下它作为归还目标
                  closePalette()
                  setShortcutsOpen(true)
                }}
              />
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {notice ? (
              <m.div
                className="w1-toast"
                role="status"
                initial={{ opacity: 0, transform: 'translateY(8px)' }}
                animate={{ opacity: 1, transform: 'translateY(0px)' }}
                exit={{ opacity: 0, transform: 'translateY(6px)' }}
                transition={{ duration: DURATION.toast, ease: EASE_OUT }}
              >
                <i />
                {notice.text}
                {notice.action ? (
                  <button
                    className="w1-toastact"
                    type="button"
                    onClick={() => {
                      notice.action?.run()
                      setNotice(null)
                      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
                    }}
                  >
                    {notice.action.label}
                  </button>
                ) : null}
                <span
                  className="w1-toastbar"
                  key={notice.id}
                  style={{ '--toast-life': `${notice.duration}ms` } as CSSProperties}
                  aria-hidden="true"
                />
              </m.div>
            ) : null}
          </AnimatePresence>
        </div>
      </LazyMotion>
    </MotionConfig>
  )
}
