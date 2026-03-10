import axios from 'axios'
import {
  apiClient,
  apiDelete,
  apiPut,
  LONG_API_TIMEOUT_MS,
} from './client'
import type { UserProfile } from '../types/user'

const PROFILE_API_TIMEOUT_MS = LONG_API_TIMEOUT_MS

export async function fetchUserProfile(
  telegramUserId: string,
  signal?: AbortSignal,
): Promise<UserProfile | null> {
  try {
    const response = await apiClient.get<UserProfile>('/profile', {
      params: { telegramUserId },
      signal,
      timeout: PROFILE_API_TIMEOUT_MS,
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
  return apiPut<UserProfile, UserProfile>('/profile', payload, {
    timeout: PROFILE_API_TIMEOUT_MS,
  })
}

export async function deleteUserProfile(
  telegramUserId: string,
): Promise<void> {
  await apiDelete<{ ok: boolean }>('/profile', {
    params: { telegramUserId },
    timeout: PROFILE_API_TIMEOUT_MS,
  })
}
