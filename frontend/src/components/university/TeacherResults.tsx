import { memo } from 'react'
import { CalendarDays, ChevronRight } from 'lucide-react'
import type { Employee } from '../../api/employees'
import { getInitials } from '../../utils/university'
import {
  UniversityActionCard,
  UniversitySkeletonList,
  UniversityTextCard,
} from './UniversityStateCards'

type TeacherResultsProps = {
  hasQuery: boolean
  isLoading: boolean
  error: string | null
  teachers: Employee[]
  onRetry: () => void
  onSelectTeacher: (teacher: Employee) => void
}

type TeacherCardProps = {
  employee: Employee
  onSelect: (teacher: Employee) => void
}

const TeacherCard = memo(({ employee, onSelect }: TeacherCardProps) => (
  <button
    type="button"
    className="univer-teacher-card univer-teacher-card--interactive"
    onClick={() => onSelect(employee)}
  >
    <span className="univer-teacher-avatar">
      {employee.avatarUrl ? (
        <img src={employee.avatarUrl} alt={`Фото ${employee.fullName}`} />
      ) : (
        <span className="univer-teacher-initials">
          {getInitials(employee.fullName)}
        </span>
      )}
    </span>

    <span className="univer-teacher-content">
      <span className="univer-teacher-name">{employee.fullName}</span>

      <span className="univer-teacher-meta">
        {employee.position && (
          <span className="univer-teacher-text">{employee.position}</span>
        )}
        {employee.department && (
          <span className="univer-teacher-pill">{employee.department}</span>
        )}
        <span className="univer-teacher-pill">ID {employee.employeeId}</span>
      </span>

      <span className="univer-teacher-action-copy">
        <span className="univer-teacher-action-icon" aria-hidden="true">
          <CalendarDays size={16} />
        </span>
        Открыть расписание
      </span>
    </span>

    <span className="univer-teacher-arrow" aria-hidden="true">
      <ChevronRight size={18} />
    </span>
  </button>
))

TeacherCard.displayName = 'TeacherCard'

export const TeacherResults = ({
  hasQuery,
  isLoading,
  error,
  teachers,
  onRetry,
  onSelectTeacher,
}: TeacherResultsProps) => {
  if (!hasQuery) {
    return null
  }

  if (isLoading) {
    return <UniversitySkeletonList />
  }

  if (hasQuery && error) {
    return (
      <UniversityActionCard
        text={error}
        actionLabel="Повторить поиск"
        onAction={onRetry}
      />
    )
  }

  return (
    <section className="univer-results-section">
      {teachers.length > 0 ? (
        <div className="univer-results-list">
          {teachers.map((employee) => (
            <TeacherCard
              key={employee.id}
              employee={employee}
              onSelect={onSelectTeacher}
            />
          ))}
        </div>
      ) : (
        <UniversityTextCard
          className="univer-empty-card"
          title="Никого не найдено"
          subtitle="Попробуйте изменить запрос или указать фамилию и имя полностью."
        />
      )}
    </section>
  )
}
