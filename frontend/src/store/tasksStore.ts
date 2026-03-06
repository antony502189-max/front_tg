import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createBrowserJsonStorage } from './storage'

export type TaskPriority = 'low' | 'medium' | 'high'

export type TaskStatus = 'active' | 'done'

export type Task = {
  id: string
  title: string
  description: string
  priority: TaskPriority
  deadline: string | null
  boundLessonId?: string
  status: TaskStatus
  createdAt: string
}

export type TaskFilter = 'all' | 'active' | 'done'

type TasksState = {
  tasks: Task[]
  filter: TaskFilter
  addTask: (payload: {
    title: string
    description: string
    priority: TaskPriority
    deadline: string | null
    boundLessonId?: string
  }) => void
  updateTask: (id: string, patch: Partial<Omit<Task, 'id'>>) => void
  toggleDone: (id: string) => void
  deleteTask: (id: string) => void
  setFilter: (filter: TaskFilter) => void
}

const STORAGE_KEY = 'bsuir-nexus:tasks'

const generateId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const defaultState: Pick<TasksState, 'tasks' | 'filter'> = {
  tasks: [],
  filter: 'all',
}

const sanitizePersistedTasksState = (
  persisted: Partial<Pick<TasksState, 'tasks' | 'filter'>> | null | undefined,
): Pick<TasksState, 'tasks' | 'filter'> => ({
  tasks: Array.isArray(persisted?.tasks) ? persisted.tasks : defaultState.tasks,
  filter:
    persisted?.filter === 'active' ||
    persisted?.filter === 'done' ||
    persisted?.filter === 'all'
      ? persisted.filter
      : defaultState.filter,
})

export const useTasksStore = create<TasksState>()(
  persist(
    (set) => ({
      ...defaultState,
      addTask: ({
        title,
        description,
        priority,
        deadline,
        boundLessonId,
      }) => {
        const nextTask: Task = {
          id: generateId(),
          title: title.trim(),
          description: description.trim(),
          priority,
          deadline,
          boundLessonId,
          status: 'active',
          createdAt: new Date().toISOString(),
        }

        set((state) => ({
          tasks: [nextTask, ...state.tasks],
        }))
      },
      updateTask: (id, patch) => {
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id ? { ...task, ...patch } : task,
          ),
        }))
      },
      toggleDone: (id) => {
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id
              ? {
                  ...task,
                  status:
                    task.status === 'active' ? 'done' : 'active',
                }
              : task,
          ),
        }))
      },
      deleteTask: (id) => {
        set((state) => ({
          tasks: state.tasks.filter((task) => task.id !== id),
        }))
      },
      setFilter: (filter) => {
        set({ filter })
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createBrowserJsonStorage<
        Pick<TasksState, 'tasks' | 'filter'>
      >(),
      partialize: (state) => ({
        tasks: state.tasks,
        filter: state.filter,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizePersistedTasksState(
          persistedState as Partial<Pick<TasksState, 'tasks' | 'filter'>>,
        ),
      }),
    },
  ),
)

