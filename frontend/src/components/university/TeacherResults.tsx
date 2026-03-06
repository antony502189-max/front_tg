import { memo } from 'react'
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
}

type TeacherCardProps = {
  employee: Employee
}

const TeacherCard = memo(({ employee }: TeacherCardProps) => (
  <article className="univer-teacher-card">
    <div className="univer-teacher-avatar">
      {employee.avatarUrl ? (
        <img
          src={employee.avatarUrl}
          alt={`Фото ${employee.fullName}`}
        />
      ) : (
        <span className="univer-teacher-initials">
          {getInitials(employee.fullName)}
        </span>
      )}
    </div>
    <div className="univer-teacher-content">
      <h3 className="univer-teacher-name">
        {employee.fullName}
      </h3>
      <div className="univer-teacher-meta">
        {employee.position && (
          <span className="univer-teacher-text">
            {employee.position}
          </span>
        )}
        {employee.department && (
          <span className="univer-teacher-pill">
            {employee.department}
          </span>
        )}
      </div>
    </div>
  </article>
))

TeacherCard.displayName = 'TeacherCard'

export const TeacherResults = ({
  hasQuery,
  isLoading,
  error,
  teachers,
  onRetry,
}: TeacherResultsProps) => {
  if (isLoading) {
    return <UniversitySkeletonList />
  }

  if (hasQuery && error) {
    return (
      <UniversityActionCard
        text={error}
        actionLabel="Повторить попытку"
        onAction={onRetry}
      />
    )
  }

  return (
    <section className="univer-results-section">
      {hasQuery ? (
        teachers.length > 0 ? (
          <div className="univer-results-list">
            {teachers.map((employee) => (
              <TeacherCard
                key={employee.id}
                employee={employee}
              />
            ))}
          </div>
        ) : (
          <UniversityTextCard
            className="univer-empty-card"
            title="Ничего не найдено"
            subtitle="Попробуйте изменить запрос или проверить написание фамилии."
          />
        )
      ) : (
        <UniversityTextCard
          className="univer-helper-card"
          title="Начните с поиска"
          subtitle="Введите фамилию или часть названия кафедры, чтобы увидеть список преподавателей."
        />
      )}
    </section>
  )
}
