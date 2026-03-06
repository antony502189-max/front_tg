import { create } from 'zustand'

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

const loadInitialState = (): Pick<TasksState, 'tasks' | 'filter'> => {
  if (typeof window === 'undefined') {
    return {
      tasks: [],
      filter: 'all',
    }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        tasks: [],
        filter: 'all',
      }
    }

    const parsed = JSON.parse(raw) as Partial<TasksState>

    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      filter: parsed.filter ?? 'all',
    }
  } catch {
    return {
      tasks: [],
      filter: 'all',
    }
  }
}

const persistState = (state: TasksState) => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const payload: Pick<TasksState, 'tasks' | 'filter'> = {
      tasks: state.tasks,
      filter: state.filter,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore persistence errors
  }
}

const generateId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const useTasksStore = create<TasksState>((set, get) => ({
  ...loadInitialState(),
  addTask: ({ title, description, priority, deadline, boundLessonId }) => {
    const now = new Date().toISOString()
    const nextTask: Task = {
      id: generateId(),
      title: title.trim(),
      description: description.trim(),
      priority,
      deadline,
      boundLessonId,
      status: 'active',
      createdAt: now,
    }

    const nextState: TasksState = {
      ...get(),
      tasks: [nextTask, ...get().tasks],
    }

    persistState(nextState)
    set(nextState)
  },
  updateTask: (id, patch) => {
    const nextState: TasksState = {
      ...get(),
      tasks: get().tasks.map((task) =>
        task.id === id ? { ...task, ...patch } : task,
      ),
    }
    persistState(nextState)
    set(nextState)
  },
  toggleDone: (id) => {
    const nextState: TasksState = {
      ...get(),
      tasks: get().tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: task.status === 'active' ? 'done' : 'active',
            }
          : task,
      ),
    }
    persistState(nextState)
    set(nextState)
  },
  deleteTask: (id) => {
    const nextState: TasksState = {
      ...get(),
      tasks: get().tasks.filter((task) => task.id !== id),
    }
    persistState(nextState)
    set(nextState)
  },
  setFilter: (filter) => {
    const nextState: TasksState = {
      ...get(),
      filter,
    }
    persistState(nextState)
    set(nextState)
  },
}))

