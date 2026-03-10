import {
  useDeferredValue,
  useEffect,
  useState,
  type FormEvent,
} from 'react'
import { Search } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { getApiErrorMessage } from '../../api/client'
import { saveUserProfile } from '../../api/profile'
import { searchTeachers, type Employee } from '../../api/employees'
import { useAsyncResource } from '../../hooks/useAsyncResource'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { GROUP_LENGTH } from '../../hooks/useStudentProfileForm'
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
  iisLogin: boolean
  teacher: boolean
}

const EMPTY_EMPLOYEES: Employee[] = []

const defaultTouched: TouchedState = {
  group: false,
  iisLogin: false,
  teacher: false,
}

const normalizeTeacherQuery = (value: string) =>
  value.trim().replace(/\s+/g, ' ')

const buildSelectedTeacher = ({
  employeeId,
  urlId,
  fullName,
  position,
  department,
  avatarUrl,
}: {
  employeeId: string
  urlId: string
  fullName: string
  position: string
  department: string
  avatarUrl: string
}): Employee | null => {
  if (!employeeId || !urlId || !fullName) {
    return null
  }

  return {
    id: urlId || employeeId,
    employeeId,
    urlId,
    fullName,
    position: position || undefined,
    department: department || undefined,
    avatarUrl: avatarUrl || undefined,
  }
}

const ROLE_OPTIONS: Array<{
  value: UserRole
  label: string
  description: string
}> = [
  {
    value: 'student',
    label: 'Я студент',
    description: 'Группа, логин IIS, оценки и расписание по группе.',
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
  const {
    applyUserProfile,
    subgroup,
    role: roleFromStore,
    groupNumber: initialGroupNumber,
    studentCardNumber: initialStudentCardNumber,
    iisLogin: initialIisLogin,
    hasIisPassword: initialHasIisPassword,
    employeeId: initialEmployeeId,
    urlId: initialUrlId,
    fullName: initialFullName,
    position: initialPosition,
    department: initialDepartment,
    avatarUrl: initialAvatarUrl,
  } = useUserStore(
    useShallow((state) => ({
      applyUserProfile: state.applyUserProfile,
      subgroup: state.subgroup,
      role: state.role,
      groupNumber: state.groupNumber,
      studentCardNumber: state.studentCardNumber,
      iisLogin: state.iisLogin,
      hasIisPassword: state.hasIisPassword,
      employeeId: state.employeeId,
      urlId: state.urlId,
      fullName: state.fullName,
      position: state.position,
      department: state.department,
      avatarUrl: state.avatarUrl,
    })),
  )

  const [role, setRole] = useState<UserRole>(
    roleFromStore ?? 'student',
  )
  const [groupNumber, setGroupNumber] = useState(
    initialGroupNumber,
  )
  const initialStudentLogin =
    initialIisLogin || initialStudentCardNumber
  const [iisLogin, setIisLogin] = useState(initialStudentLogin)
  const [iisPassword, setIisPassword] = useState('')
  const [teacherQuery, setTeacherQuery] = useState(initialFullName)
  const [selectedTeacher, setSelectedTeacher] = useState(
    () =>
      buildSelectedTeacher({
        employeeId: initialEmployeeId,
        urlId: initialUrlId,
        fullName: initialFullName,
        position: initialPosition,
        department: initialDepartment,
        avatarUrl: initialAvatarUrl,
      }),
  )
  const [touched, setTouched] = useState<TouchedState>(defaultTouched)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setRole(roleFromStore ?? 'student')
    setGroupNumber(initialGroupNumber)
    setIisLogin(initialIisLogin || initialStudentCardNumber)
    setIisPassword('')
    setTeacherQuery(initialFullName)
    setSelectedTeacher(
      buildSelectedTeacher({
        employeeId: initialEmployeeId,
        urlId: initialUrlId,
        fullName: initialFullName,
        position: initialPosition,
        department: initialDepartment,
        avatarUrl: initialAvatarUrl,
      }),
    )
    setTouched(defaultTouched)
    setSaveError(null)
  }, [
    initialAvatarUrl,
    initialDepartment,
    initialEmployeeId,
    initialFullName,
    initialGroupNumber,
    initialHasIisPassword,
    initialIisLogin,
    initialPosition,
    initialStudentCardNumber,
    initialUrlId,
    roleFromStore,
  ])

  const normalizedTeacherQuery = normalizeTeacherQuery(teacherQuery)
  const selectedTeacherQuery = selectedTeacher
    ? normalizeTeacherQuery(selectedTeacher.fullName)
    : ''
  const deferredTeacherQuery = useDeferredValue(
    normalizedTeacherQuery,
  )
  const debouncedTeacherQuery = useDebouncedValue(
    deferredTeacherQuery,
    300,
  )
  const hasDebouncedTeacherQuery =
    role === 'teacher' && debouncedTeacherQuery.length >= 2
  const shouldSearchTeachers =
    hasDebouncedTeacherQuery &&
    (!selectedTeacher ||
      debouncedTeacherQuery !== selectedTeacherQuery)
  const isTeacherSearchPending =
    role === 'teacher' &&
    normalizedTeacherQuery.length >= 2 &&
    normalizedTeacherQuery !== debouncedTeacherQuery &&
    (!selectedTeacher ||
      normalizedTeacherQuery !== selectedTeacherQuery)

  const teacherResource = useAsyncResource<Employee[]>({
    enabled: shouldSearchTeachers,
    requestKey: shouldSearchTeachers
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
  const normalizedIisLogin = iisLogin.trim()
  const normalizedInitialIisLogin = initialStudentLogin.trim()
  const isIisLoginChanged =
    normalizedIisLogin !== normalizedInitialIisLogin
  const isIisLoginValid = normalizedIisLogin.length > 0
  const isStudentFormValid =
    isGroupValid &&
    isIisLoginValid
  const isTeacherFormValid = selectedTeacher !== null
  const isFormValid =
    role === 'student' ? isStudentFormValid : isTeacherFormValid
  const shouldRenderTeacherSearchResults =
    isTeacherSearchPending ||
    teacherResource.isLoading ||
    teacherResource.error !== null ||
    shouldSearchTeachers ||
    selectedTeacher === null

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
      teacher:
        normalizeTeacherQuery(value).length > 0
          ? current.teacher
          : false,
    }))

    if (
      selectedTeacher &&
      normalizeTeacherQuery(value) !== selectedTeacherQuery
    ) {
      setSelectedTeacher(null)
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched({
      group: true,
      iisLogin: true,
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
              studentCardNumber: normalizedIisLogin,
              iisLogin: normalizedIisLogin || undefined,
              iisPassword: iisPassword.trim() || undefined,
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
              <label htmlFor="profile-iis-login" className="onboarding-label">
                Логин IIS
              </label>
              <input
                id="profile-iis-login"
                inputMode="numeric"
                autoComplete="username"
                className={`onboarding-input${
                  touched.iisLogin && !isIisLoginValid
                    ? ' onboarding-input--error'
                    : ''
                }`}
                placeholder="Например, 56841017"
                value={iisLogin}
                onChange={(event) => setIisLogin(event.target.value.trim())}
                onBlur={() =>
                  setTouched((current) => ({
                    ...current,
                    iisLogin: true,
                  }))
                }
              />
              {touched.iisLogin && !isIisLoginValid ? (
                <p className="onboarding-error">
                  Укажите логин IIS, чтобы видеть оценки и пропуски.
                </p>
              ) : (
                <p className="onboarding-hint">
                  Используется и для оценок, и для пропусков.
                </p>
              )}
            </div>

            <div className="onboarding-field">
              <label
                htmlFor="profile-iis-password"
                className="onboarding-label"
              >
                Пароль IIS
              </label>
              <input
                id="profile-iis-password"
                type="password"
                autoComplete="current-password"
                className="onboarding-input"
                placeholder={
                  initialHasIisPassword
                    ? 'Оставьте пустым, чтобы не менять'
                    : 'Введите пароль IIS'
                }
                value={iisPassword}
                onChange={(event) => setIisPassword(event.target.value)}
              />
              <p className="onboarding-hint">
                {initialHasIisPassword && !isIisLoginChanged
                  ? 'Пароль сохранён.'
                  : 'Пароль нужен только для загрузки пропусков.'}
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="onboarding-field">
              <label htmlFor="profile-teacher" className="onboarding-label">
                ФИО преподавателя
              </label>
              <div
                className={`profile-search-input-wrapper${
                  touched.teacher && !isTeacherFormValid
                    ? ' profile-search-input-wrapper--error'
                    : ''
                }`}
              >
                <span className="profile-search-icon" aria-hidden="true">
                  <Search size={16} />
                </span>
                <input
                  id="profile-teacher"
                  type="search"
                  autoComplete="off"
                  className="onboarding-input onboarding-input--search"
                  aria-invalid={touched.teacher && !isTeacherFormValid}
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
                Сначала найдите преподавателя, затем выберите его из списка.
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

            {shouldRenderTeacherSearchResults && (
              <div className="profile-search-results">
                {isTeacherSearchPending ||
                teacherResource.isLoading ? (
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
                ) : shouldSearchTeachers ? (
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
                      Минимум 2 символа. После выбора профиль сохранится.
                    </p>
                  </div>
                )}
              </div>
            )}
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
