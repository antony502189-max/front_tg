import { useState, type FormEvent } from 'react'
import {
  selectTodayLessons,
  useScheduleStore,
} from '../../store/scheduleStore'
import { useTasksStore, type TaskPriority } from '../../store/tasksStore'

type NewTaskModalProps = {
  isOpen: boolean
  onClose: () => void
}

export const NewTaskModal = ({ isOpen, onClose }: NewTaskModalProps) => {
  const addTask = useTasksStore((state) => state.addTask)
  const todayLessons = useScheduleStore(selectTodayLessons)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [deadline, setDeadline] = useState<string>('')
  const [boundLessonId, setBoundLessonId] = useState<string>('')

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setPriority('medium')
    setDeadline('')
    setBoundLessonId('')
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    addTask({
      title: trimmedTitle,
      description: description.trim(),
      priority,
      deadline: deadline || null,
      boundLessonId: boundLessonId || undefined,
    })

    handleClose()
  }

  const hasLessonsToday = todayLessons.length > 0

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="planner-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          handleClose()
        }
      }}
    >
      <div
        className="planner-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="planner-modal-title"
      >
        <h2 id="planner-modal-title" className="planner-modal-title">
          Новая задача
        </h2>

        <form
          className="planner-modal-form"
          onSubmit={handleSubmit}
        >
          <label className="planner-modal-field">
            <span className="planner-modal-label">
              Что нужно сделать?
            </span>
            <input
              className="planner-modal-input"
              type="text"
              placeholder="Например, подготовиться к коллоквиуму"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label className="planner-modal-field">
            <span className="planner-modal-label">Описание</span>
            <textarea
              className="planner-modal-textarea"
              placeholder="Дополнительные детали, ссылки или заметки"
              rows={3}
              value={description}
              onChange={(event) =>
                setDescription(event.target.value)
              }
            />
          </label>

          <div className="planner-modal-row">
            <label className="planner-modal-field planner-modal-field--half">
              <span className="planner-modal-label">
                Приоритет
              </span>
              <select
                className="planner-modal-input"
                value={priority}
                onChange={(event) =>
                  setPriority(event.target.value as TaskPriority)
                }
              >
                <option value="low">Низкий</option>
                <option value="medium">Средний</option>
                <option value="high">Высокий</option>
              </select>
            </label>

            <label className="planner-modal-field planner-modal-field--half">
              <span className="planner-modal-label">
                Дедлайн
              </span>
              <input
                className="planner-modal-input"
                type="date"
                value={deadline}
                onChange={(event) =>
                  setDeadline(event.target.value)
                }
              />
            </label>
          </div>

          <label className="planner-modal-field">
            <span className="planner-modal-label">
              Привязка к паре
            </span>
            <select
              className="planner-modal-input"
              value={boundLessonId}
              onChange={(event) =>
                setBoundLessonId(event.target.value)
              }
            >
              <option value="">
                {hasLessonsToday
                  ? 'Без привязки'
                  : 'Нет пар на сегодня'}
              </option>
              {todayLessons.map((lesson) => (
                <option key={lesson.id} value={lesson.id}>
                  {lesson.startTime}-{lesson.endTime} ·{' '}
                  {lesson.subject}
                </option>
              ))}
            </select>
          </label>

          <div className="planner-modal-actions">
            <button
              type="button"
              className="planner-modal-button planner-modal-button--ghost"
              onClick={handleClose}
            >
              Отмена
            </button>
            <button
              type="submit"
              className="planner-modal-button"
              disabled={!title.trim()}
            >
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

