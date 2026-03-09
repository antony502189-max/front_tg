import { useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getApiErrorMessage } from '../api/client'
import { saveUserProfile } from '../api/profile'
import { useUserStore, type Subgroup } from '../store/userStore'
import { resolveSessionUserId } from '../telegram/session'
import type { UserProfile } from '../types/user'

const buildProfilePayload = ({
  role,
  subgroup,
  groupNumber,
  studentCardNumber,
  employeeId,
  urlId,
  fullName,
  position,
  department,
  avatarUrl,
}: {
  role: UserProfile['role'] | null
  subgroup: Subgroup
  groupNumber: string
  studentCardNumber: string
  employeeId: string
  urlId: string
  fullName: string
  position: string
  department: string
  avatarUrl: string
}): UserProfile | null => {
  const telegramUserId = resolveSessionUserId()

  if (!role || !telegramUserId) {
    return null
  }

  if (role === 'student') {
    return {
      telegramUserId,
      role: 'student',
      subgroup,
      groupNumber: groupNumber.trim(),
      studentCardNumber: studentCardNumber.trim(),
    }
  }

  return {
    telegramUserId,
    role: 'teacher',
    subgroup,
    employeeId: employeeId.trim(),
    urlId: urlId.trim(),
    fullName: fullName.trim(),
    position: position.trim(),
    department: department.trim(),
    avatarUrl: avatarUrl.trim(),
  }
}

export const useSubgroupPreference = () => {
  const {
    role,
    subgroup,
    groupNumber,
    studentCardNumber,
    employeeId,
    urlId,
    fullName,
    position,
    department,
    avatarUrl,
    setSubgroup,
    applyUserProfile,
  } = useUserStore(
    useShallow((state) => ({
      role: state.role,
      subgroup: state.subgroup,
      groupNumber: state.groupNumber,
      studentCardNumber: state.studentCardNumber,
      employeeId: state.employeeId,
      urlId: state.urlId,
      fullName: state.fullName,
      position: state.position,
      department: state.department,
      avatarUrl: state.avatarUrl,
      setSubgroup: state.setSubgroup,
      applyUserProfile: state.applyUserProfile,
    })),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateSubgroup = useCallback(
    async (nextSubgroup: Subgroup) => {
      if (role !== 'student' || nextSubgroup === subgroup || isSaving) {
        return
      }

      const previousSubgroup = subgroup
      const payload = buildProfilePayload({
        role,
        subgroup: nextSubgroup,
        groupNumber,
        studentCardNumber,
        employeeId,
        urlId,
        fullName,
        position,
        department,
        avatarUrl,
      })

      setError(null)
      setSubgroup(nextSubgroup)

      if (!payload) {
        return
      }

      setIsSaving(true)
      try {
        const savedProfile = await saveUserProfile(payload)
        applyUserProfile(savedProfile)
      } catch (requestError) {
        setSubgroup(previousSubgroup)
        setError(
          getApiErrorMessage(
            requestError,
            'Не удалось сохранить подгруппу. Попробуйте ещё раз.',
          ),
        )
      } finally {
        setIsSaving(false)
      }
    },
    [
      applyUserProfile,
      avatarUrl,
      department,
      employeeId,
      fullName,
      groupNumber,
      isSaving,
      position,
      role,
      setSubgroup,
      studentCardNumber,
      subgroup,
      urlId,
    ],
  )

  return {
    subgroup,
    isSaving,
    error,
    setSubgroup: updateSubgroup,
  }
}
