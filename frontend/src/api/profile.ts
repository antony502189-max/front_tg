import axios from 'axios'
import { apiClient, apiDelete, apiPut } from './client'
import type { UserProfile } from '../types/user'

export async function fetchUserProfile(
  telegramUserId: string,
  signal?: AbortSignal,
): Promise<UserProfile | null> {
  try {
    const response = await apiClient.get<UserProfile>('/profile', {
      params: { telegramUserId },
      signal,
    })

    return response.data
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null
    }

    throw error
  }
}

export async function saveUserProfile(
  payload: UserProfile,
): Promise<UserProfile> {
  return apiPut<UserProfile, UserProfile>('/profile', payload)
}

export async function deleteUserProfile(
  telegramUserId: string,
): Promise<void> {
  await apiDelete<{ ok: boolean }>('/profile', {
    params: { telegramUserId },
  })
}
