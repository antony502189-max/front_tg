import {
  useDeferredValue,
  useEffect,
  useState,
  type FormEvent,
} from 'react'
import { Search } from 'lucide-react'
import { getApiErrorMessage } from '../../api/client'
import { saveUserProfile } from '../../api/profile'
import { searchTeachers, type Employee } from '../../api/employees'
import { useAsyncResource } from '../../hooks/useAsyncResource'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import {
  GROUP_LENGTH,
  STUDENT_CARD_MAX_LENGTH,
  STUDENT_CARD_MIN_LENGTH,
} from '../../hooks/useStudentProfileForm'
import { useUserStore } from '../../store/userStore'
import { resolveSessionUserId } from '../../telegram/session'
import type { UserRole } from '../../types/user'
import { getInitials } from '../../utils/university'

type ProfileEditorProps = {
  title: string
  subtitle: string
  submitLabel: string
  onSaved?: () => void
}

type TouchedState = {
  group: boolean
  card: boolean
  teacher: boolean
}

const EMPTY_EMPLOYEES: Employee[] = []

const defaultTouched: TouchedState = {
  group: false,
  card: false,
  teacher: false,
}

const ROLE_OPTIONS: Array<{
  value: UserRole
  label: string
  description: string
}> = [
  {
    value: 'student',
    label: 'Я студент',
    description: 'Группа, зачётка, оценки и расписание по группе.',
  },
  {
    value: 'teacher',
    label: 'Я преподаватель',
    description: 'Поиск по ФИО и расписание по профилю преподавателя.',
  },
]

export const ProfileEditor = ({
  title,
  subtitle,
  submitLabel,
  onSaved,
}: ProfileEditorProps) => {
  const applyUserProfile = useUserStore(
    (state) => state.applyUserProfile,
  )
  const subgroup = useUserStore((state) => state.subgroup)
  const roleFromStore = useUserStore((state) => state.role)
  const initialGroupNumber = useUserStore(
    (state) => state.groupNumber,
  )
  const initialStudentCardNumber = useUserStore(
    (state) => state.studentCardNumber,
  )
  const initialEmployeeId = useUserStore(
    (state) => state.employeeId,
  )
  const initialUrlId = useUserStore((state) => state.urlId)
  const initialFullName = useUserStore((state) => state.fullName)
  const initialPosition = useUserStore((state) => state.position)
  const initialDepartment = useUserStore((state) => state.department)
  const initialAvatarUrl = useUserStore((state) => state.avatarUrl)

  const [role, setRole] = useState<UserRole>(
    roleFromStore ?? 'student',
  )
  const [groupNumber, setGroupNumber] = useState(
    initialGroupNumber,
  )
  const [studentCardNumber, setStudentCardNumber] = useState(
    initialStudentCardNumber,
  )
  const [teacherQuery, setTeacherQuery] = useState(initialFullName)
  const [selectedTeacher, setSelectedTeacher] = useState<Employee | null>(
    initialEmployeeId && initialUrlId && initialFullName
      ? {
          id: initialUrlId || initialEmployeeId,
          employeeId: initialEmployeeId,
          urlId: initialUrlId,
          fullName: initialFullName,
          position: initialPosition || undefined,
          department: initialDepartment || undefined,
          avatarUrl: initialAvatarUrl || undefined,
        }
      : null,
  )
  const [touched, setTouched] = useState<TouchedState>(defaultTouched)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setRole(roleFromStore ?? 'student')
    setGroupNumber(initialGroupNumber)
    setStudentCardNumber(initialStudentCardNumber)
    setTeacherQuery(initialFullName)
    setSelectedTeacher(
      initialEmployeeId && initialUrlId && initialFullName
        ? {
            id: initialUrlId || initialEmployeeId,
            employeeId: initialEmployeeId,
            urlId: initialUrlId,
            fullName: initialFullName,
            position: initialPosition || undefined,
            department: initialDepartment || undefined,
            avatarUrl: initialAvatarUrl || undefined,
          }
        : null,
    )
    setTouched(defaultTouched)
    setSaveError(null)
  }, [
    initialAvatarUrl,
    initialDepartment,
    initialEmployeeId,
    initialFullName,
    initialGroupNumber,
    initialPosition,
    initialStudentCardNumber,
    initialUrlId,
    roleFromStore,
  ])

  const deferredTeacherQuery = useDeferredValue(
    teacherQuery.trim(),
  )
  const debouncedTeacherQuery = useDebouncedValue(
    deferredTeacherQuery,
    300,
  )
  const hasTeacherQuery =
    role === 'teacher' && debouncedTeacherQuery.length >= 2

  const teacherResource = useAsyncResource<Employee[]>({
    enabled: hasTeacherQuery,
    requestKey: hasTeacherQuery
      ? `teacher-search:${debouncedTeacherQuery}`
      : null,
    initialData: EMPTY_EMPLOYEES,
    load: (signal) => searchTeachers(debouncedTeacherQuery, signal),
    getErrorMessage: (error) =>
      getApiErrorMessage(
        error,
        'Не удалось загрузить преподавателей. Попробуйте ещё раз.',
      ),
  })

  const isGroupValid = groupNumber.length === GROUP_LENGTH
  const isCardValid =
    studentCardNumber.trim().length >= STUDENT_CARD_MIN_LENGTH
  const isStudentFormValid = isGroupValid && isCardValid
  const isTeacherFormValid = selectedTeacher !== null
  const isFormValid =
    role === 'student' ? isStudentFormValid : isTeacherFormValid

  const handleRoleChange = (nextRole: UserRole) => {
    if (nextRole === role) {
      return
    }

    setRole(nextRole)
    setTouched(defaultTouched)
    setSaveError(null)
  }

  const handleTeacherQueryChange = (value: string) => {
    setTeacherQuery(value)
    setTouched((current) => ({
      ...current,
      teacher: value.trim().length > 0 ? current.teacher : false,
    }))

    if (
      selectedTeacher &&
      value.trim() !== selectedTeacher.fullName
    ) {
      setSelectedTeacher(null)
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched({
      group: true,
      card: true,
      teacher: true,
    })

    if (!isFormValid) {
      return
    }

    setIsSaving(true)
    setSaveError(null)

    try {
      const sessionUserId = resolveSessionUserId()
      const savedProfile = await saveUserProfile(
        role === 'student'
          ? {
              telegramUserId: sessionUserId,
              role: 'student',
              subgroup,
              groupNumber: groupNumber.trim(),
              studentCardNumber: studentCardNumber.trim(),
            }
          : {
              telegramUserId: sessionUserId,
              role: 'teacher',
              subgroup,
              employeeId: selectedTeacher?.employeeId,
              urlId: selectedTeacher?.urlId,
              fullName: selectedTeacher?.fullName,
              position: selectedTeacher?.position,
              department: selectedTeacher?.department,
              avatarUrl: selectedTeacher?.avatarUrl,
            },
      )

      applyUserProfile(savedProfile)
      onSaved?.()
    } catch (error) {
      setSaveError(
        getApiErrorMessage(
          error,
          'Не удалось сохранить профиль. Попробуйте ещё раз.',
        ),
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="profile-editor-card">
      <header className="profile-editor-header">
        <h1 className="profile-editor-title">{title}</h1>
        <p className="profile-editor-subtitle">{subtitle}</p>
      </header>

      <div className="profile-role-grid">
        {ROLE_OPTIONS.map((option) => {
          const isActive = role === option.value

          return (
            <button
              key={option.value}
              type="button"
              className={`profile-role-card${
                isActive ? ' profile-role-card--active' : ''
              }`}
              onClick={() => handleRoleChange(option.value)}
            >
              <span className="profile-role-label">
                {option.label}
              </span>
              <span className="profile-role-description">
                {option.description}
              </span>
            </button>
          )
        })}
      </div>

      <form
        className="profile-editor-form"
        onSubmit={handleSubmit}
        noValidate
      >
        {role === 'student' ? (
          <>
            <div className="onboarding-field">
              <label htmlFor="profile-group" className="onboarding-label">
                Учебная группа
              </label>
              <input
                id="profile-group"
                inputMode="numeric"
                autoComplete="off"
                className={`onboarding-input${
                  touched.group && !isGroupValid
                    ? ' onboarding-input--error'
                    : ''
                }`}
                placeholder="Например, 353502"
                value={groupNumber}
                onChange={(event) =>
                  setGroupNumber(
                    event.target.value
                      .replace(/\D/g, '')
                      .slice(0, GROUP_LENGTH),
                  )
                }
                onBlur={() =>
                  setTouched((current) => ({
                    ...current,
                    group: true,
                  }))
                }
              />
              {touched.group && !isGroupValid ? (
                <p className="onboarding-error">
                  Номер группы должен содержать ровно {GROUP_LENGTH}{' '}
                  цифр.
                </p>
              ) : (
                <p className="onboarding-hint">
                  Только цифры, без пробелов и букв.
                </p>
              )}
            </div>

            <div className="onboarding-field">
              <label htmlFor="profile-card" className="onboarding-label">
                Номер зачётки
              </label>
              <input
                id="profile-card"
                inputMode="numeric"
                autoComplete="off"
                className={`onboarding-input${
                  touched.card && !isCardValid
                    ? ' onboarding-input--error'
                    : ''
                }`}
                placeholder="Как в IIS, например 56841006"
                value={studentCardNumber}
                onChange={(event) =>
                  setStudentCardNumber(
                    event.target.value
                      .replace(/\D/g, '')
                      .slice(0, STUDENT_CARD_MAX_LENGTH),
                  )
                }
                onBlur={() =>
                  setTouched((current) => ({
                    ...current,
                    card: true,
                  }))
                }
              />
              {touched.card && !isCardValid ? (
                <p className="onboarding-error">
                  Введите номер зачётки минимум из{' '}
                  {STUDENT_CARD_MIN_LENGTH} символов.
                </p>
              ) : (
                <p className="onboarding-hint">
                  Нужен для вкладки с оценками и данными по учёбе.
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="onboarding-field">
              <label htmlFor="profile-teacher" className="onboarding-label">
                ФИО преподавателя
              </label>
              <div className="profile-search-input-wrapper">
                <span className="profile-search-icon" aria-hidden="true">
                  <Search size={16} />
                </span>
                <input
                  id="profile-teacher"
                  type="search"
                  autoComplete="off"
                  className={`onboarding-input onboarding-input--search${
                    touched.teacher && !isTeacherFormValid
                      ? ' onboarding-input--error'
                      : ''
                  }`}
                  placeholder="Введите фамилию и инициалы"
                  value={teacherQuery}
                  onChange={(event) =>
                    handleTeacherQueryChange(event.target.value)
                  }
                  onBlur={() =>
                    setTouched((current) => ({
                      ...current,
                      teacher: true,
                    }))
                  }
                />
              </div>
              <p className="onboarding-hint">
                Сначала найдите преподавателя через backend, затем выберите его из списка.
              </p>
            </div>

            {selectedTeacher && (
              <div className="profile-selected-teacher">
                <div className="profile-selected-teacher-avatar">
                  {selectedTeacher.avatarUrl ? (
                    <img
                      src={selectedTeacher.avatarUrl}
                      alt={selectedTeacher.fullName}
                    />
                  ) : (
                    <span>{getInitials(selectedTeacher.fullName)}</span>
                  )}
                </div>
                <div className="profile-selected-teacher-content">
                  <strong>{selectedTeacher.fullName}</strong>
                  <span>
                    {selectedTeacher.position || 'Преподаватель'}
                    {selectedTeacher.department
                      ? ` · ${selectedTeacher.department}`
                      : ''}
                  </span>
                </div>
              </div>
            )}

            <div className="profile-search-results">
              {teacherResource.isLoading ? (
                <div className="univer-skeleton-list">
                  <div className="univer-skeleton-card" />
                  <div className="univer-skeleton-card" />
                </div>
              ) : teacherResource.error ? (
                <div className="univer-error-card">
                  <p className="univer-error-text">
                    {teacherResource.error}
                  </p>
                  <button
                    type="button"
                    className="univer-retry-button"
                    onClick={teacherResource.reload}
                  >
                    Повторить поиск
                  </button>
                </div>
              ) : hasTeacherQuery ? (
                teacherResource.data.length > 0 ? (
                  <div className="profile-teacher-list">
                    {teacherResource.data.map((teacher) => {
                      const isSelected =
                        selectedTeacher?.employeeId === teacher.employeeId

                      return (
                        <button
                          key={`${teacher.employeeId}:${teacher.urlId}`}
                          type="button"
                          className={`profile-teacher-option${
                            isSelected
                              ? ' profile-teacher-option--selected'
                              : ''
                          }`}
                          onClick={() => {
                            setSelectedTeacher(teacher)
                            setTeacherQuery(teacher.fullName)
                            setTouched((current) => ({
                              ...current,
                              teacher: true,
                            }))
                          }}
                        >
                          <div className="profile-teacher-option-avatar">
                            {teacher.avatarUrl ? (
                              <img
                                src={teacher.avatarUrl}
                                alt={teacher.fullName}
                              />
                            ) : (
                              <span>{getInitials(teacher.fullName)}</span>
                            )}
                          </div>
                          <div className="profile-teacher-option-content">
                            <strong>{teacher.fullName}</strong>
                            <span>
                              {teacher.position || 'Преподаватель'}
                              {teacher.department
                                ? ` · ${teacher.department}`
                                : ''}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="univer-empty-card">
                    <h3 className="univer-helper-title">
                      Ничего не найдено
                    </h3>
                    <p className="univer-helper-subtitle">
                      Уточните фамилию или попробуйте другой формат ФИО.
                    </p>
                  </div>
                )
              ) : (
                <div className="univer-helper-card">
                  <h3 className="univer-helper-title">
                    Начните поиск преподавателя
                  </h3>
                  <p className="univer-helper-subtitle">
                    Минимум 2 символа. После выбора профиль сохранит `employeeId` и `urlId`.
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {saveError && (
          <div className="schedule-error-card">
            <p className="schedule-error-text">{saveError}</p>
          </div>
        )}

        <button
          type="submit"
          className="onboarding-submit"
          disabled={!isFormValid || isSaving}
        >
          {isSaving ? 'Сохраняем...' : submitLabel}
        </button>
      </form>
    </section>
  )
}
