import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { NewTaskModal } from '../components/planner/NewTaskModal'
import { TaskCard } from '../components/planner/TaskCard'
import {
  selectTodayLessons,
  useScheduleStore,
} from '../store/scheduleStore'
import {
  useTasksStore,
  type Task,
  type TaskFilter,
} from '../store/tasksStore'

const FILTER_LABELS: Record<TaskFilter, string> = {
  all: 'Все',
  active: 'Активные',
  done: 'Готовые',
}

const filterTasks = (tasks: Task[], filter: TaskFilter) => {
  if (filter === 'active') {
    return tasks.filter((task) => task.status === 'active')
  }
  if (filter === 'done') {
    return tasks.filter((task) => task.status === 'done')
  }
  return tasks
}

export const PlannerPage = () => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { tasks, filter, setFilter, toggleDone, deleteTask } =
    useTasksStore(
      useShallow((state) => ({
        tasks: state.tasks,
        filter: state.filter,
        setFilter: state.setFilter,
        toggleDone: state.toggleDone,
        deleteTask: state.deleteTask,
      })),
    )

  const todayLessons = useScheduleStore(selectTodayLessons)

  const filteredTasks = useMemo(
    () => filterTasks(tasks, filter),
    [tasks, filter],
  )

  const lessonsById = useMemo(() => {
    const map = new Map<string, (typeof todayLessons)[number]>()
    todayLessons.forEach((lesson) => {
      map.set(lesson.id, lesson)
    })
    return map
  }, [todayLessons])

  const hasTasks = filteredTasks.length > 0

  return (
    <div className="planner-page">
      <div className="planner-inner">
        <header className="planner-header">
          <div>
            <h1 className="planner-title">Планер</h1>
            <p className="planner-subtitle">
              Фиксируйте дела и привязывайте их к парам
              на сегодня.
            </p>
          </div>
        </header>

        <div className="planner-filters">
          {(Object.keys(FILTER_LABELS) as TaskFilter[]).map(
            (key) => (
              <button
                key={key}
                type="button"
                className={`planner-filter-chip${
                  key === filter
                    ? ' planner-filter-chip--active'
                    : ''
                }`}
                onClick={() => setFilter(key)}
              >
                {FILTER_LABELS[key]}
              </button>
            ),
          )}
        </div>

        <div className="planner-task-list">
          {hasTasks ? (
            filteredTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                boundLesson={
                  task.boundLessonId
                    ? lessonsById.get(task.boundLessonId)
                    : undefined
                }
                onToggleDone={toggleDone}
                onDelete={deleteTask}
              />
            ))
          ) : (
            <div className="planner-empty-card">
              <h2 className="planner-empty-title">
                Всё выполнено!
              </h2>
              <p className="planner-empty-subtitle">
                Добавьте первую задачу, чтобы ничего не
                забыть.
              </p>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        className="planner-fab"
        onClick={() => setIsModalOpen(true)}
        aria-label="Добавить задачу"
      >
        +
      </button>

      <NewTaskModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  )
}


