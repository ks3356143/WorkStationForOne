import { selectPreviewNotes, useWorkstation } from '../store/useWorkstation'
import { PinIcon } from './Glyphs'

export function NoteCard() {
  const notes = useWorkstation((state) => state.notes)
  const openQuickNote = useWorkstation((state) => state.openQuickNote)
  const openNotesView = useWorkstation((state) => state.openNotesView)
  const { pinned, rest } = selectPreviewNotes(notes)

  return (
    <section className="w1-card w1-note">
      <div className="w1-ct">
        <b>
          <em>//</em>快速笔记
        </b>
        <button className="w1-ctlink" type="button" onClick={openQuickNote} title="新建笔记">
          ^N
        </button>
      </div>

      {pinned ? (
        <div className="w1-nmain">
          <div className="w1-npin">
            <PinIcon width={12} height={12} />
          </div>
          <div className="w1-nbody">
            <div className="w1-ntext">{pinned.text}</div>
            <div className="w1-ntags">
              <b>{pinned.tag ?? '随手记'}</b>
              <span>{pinned.time}</span>
            </div>
          </div>
        </div>
      ) : null}

      <div className="w1-nlist">
        {rest.map((note) => (
          <div className="w1-nitem" key={note.id}>
            <span>{note.text}</span>
            <time>{note.time}</time>
          </div>
        ))}
      </div>

      <div className="w1-nfoot">
        <b>{notes.length} 条笔记</b>
        <button className="w1-nall" type="button" onClick={openNotesView}>
          全部 →
        </button>
      </div>
    </section>
  )
}
