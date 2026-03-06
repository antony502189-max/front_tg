import { apiClient } from './client'

export type Employee = {
  id: string
  fullName: string
  position?: string
  department?: string
  avatarUrl?: string
}

export async function searchTeachers(query: string): Promise<Employee[]> {
  const trimmed = query.trim()

  if (!trimmed) {
    return []
  }

  const response = await apiClient.get<Employee[]>('/employees', {
    params: { q: trimmed },
  })

  return response.data
}

