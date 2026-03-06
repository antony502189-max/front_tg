import { memo } from 'react'
import type { Lesson } from '../../store/scheduleStore'
import type { Task } from '../../store/tasksStore'

type TaskCardProps = {
  task: Task
  boundLesson?: Lesson
  onToggleDone: (taskId: string) => void
  onDelete: (taskId: string) => void
}

const formatDeadline = (deadline: string | null) => {
  if (!deadline) return null

  const [year, month, day] = deadline.split('-')
  if (!year || !month || !day) return deadline

  return `${day}.${month}.${year.slice(2)}`
}

const getPriorityLabel = (priority: Task['priority']) => {
  if (priority === 'high') return 'Высокий'
  if (priority === 'medium') return 'Средний'
  return 'Низкий'
}

export const TaskCard = memo(({
  task,
  boundLesson,
  onToggleDone,
  onDelete,
}: TaskCardProps) => {
  const deadlineLabel = formatDeadline(task.deadline)

  return (
    <article
      className={`planner-task-card${
        task.status === 'done' ? ' planner-task-card--done' : ''
      }`}
    >
      <div className="planner-task-main">
        <button
          type="button"
          className={`planner-task-checkbox${
            task.status === 'done'
              ? ' planner-task-checkbox--checked'
              : ''
          }`}
          onClick={() => onToggleDone(task.id)}
        >
          {task.status === 'done' ? '✓' : ''}
        </button>
        <div className="planner-task-content">
          <h2 className="planner-task-title">{task.title}</h2>
          {task.description && (
            <p className="planner-task-description">
              {task.description}
            </p>
          )}
        </div>
      </div>

      <div className="planner-task-meta">
        <span
          className={`planner-task-pill planner-task-pill--priority-${task.priority}`}
        >
          {getPriorityLabel(task.priority)}
        </span>

        {deadlineLabel && (
          <span className="planner-task-pill planner-task-pill--muted">
            Дедлайн: {deadlineLabel}
          </span>
        )}

        {boundLesson && (
          <span className="planner-task-pill planner-task-pill--lesson">
            {boundLesson.startTime}-{boundLesson.endTime} ·{' '}
            {boundLesson.subject}
          </span>
        )}

        <button
          type="button"
          className="planner-task-delete"
          onClick={() => onDelete(task.id)}
        >
          Удалить
        </button>
      </div>
    </article>
  )
})

TaskCard.displayName = 'TaskCard'

