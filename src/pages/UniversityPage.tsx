import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { searchTeachers, type Employee } from '../api/employees'

const getInitials = (fullName: string) => {
  const parts = fullName
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)

  if (!parts.length) return ''

  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase()
  }

  return (parts[0]![0] + parts[1]![0]).toUpperCase()
}

export const UniversityPage = () => {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Employee[]>([])
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
    }, 350)

    return () => {
      window.clearTimeout(handle)
    }
  }, [query])

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      return
    }

    let isCancelled = false

    queueMicrotask(() => {
      if (isCancelled) return

      setIsLoading(true)
      setError(null)
    })

    searchTeachers(debouncedQuery)
      .then((employees) => {
        if (isCancelled) return

        setResults(employees)
        setIsLoading(false)
      })
      .catch(() => {
        if (isCancelled) return

        setError(
          'Не удалось загрузить список преподавателей. Попробуйте ещё раз.',
        )
        setIsLoading(false)
      })

    return () => {
      isCancelled = true
    }
  }, [debouncedQuery, reloadToken])

  const hasQuery = debouncedQuery.length >= 2
  const hasResults = hasQuery && results.length > 0
  const effectiveIsLoading = hasQuery && isLoading

  const handleRetry = () => {
    setReloadToken((token) => token + 1)
  }

  return (
    <div className="planner-page">
      <div className="univer-inner">
        <header className="univer-header">
          <div>
            <h1 className="planner-title">Универ</h1>
            <p className="planner-subtitle">
              Найдите преподавателя по фамилии или кафедре.
            </p>
          </div>
        </header>

        <section className="univer-search-section">
          <div className="univer-search-input-wrapper">
            <span className="univer-search-icon" aria-hidden="true">
              <Search size={16} />
            </span>
            <input
              className="univer-search-input"
              type="search"
              placeholder="Например, Иванов или кафедра СиСИ"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <p className="univer-search-hint">
            Введите минимум 2 символа, чтобы начать поиск.
          </p>
        </section>

        {effectiveIsLoading && (
          <div className="univer-skeleton-list">
            <div className="univer-skeleton-card" />
            <div className="univer-skeleton-card" />
          </div>
        )}

        {!effectiveIsLoading && hasQuery && error && (
          <div className="univer-error-card">
            <p className="univer-error-text">{error}</p>
            {hasQuery && (
              <button
                type="button"
                className="univer-retry-button"
                onClick={handleRetry}
              >
                Повторить попытку
              </button>
            )}
          </div>
        )}

        {!effectiveIsLoading && !error && (
          <section className="univer-results-section">
            {hasQuery ? (
              hasResults ? (
                <div className="univer-results-list">
                  {results.map((employee) => (
                    <article
                      key={employee.id}
                      className="univer-teacher-card"
                    >
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
                  ))}
                </div>
              ) : (
                <div className="univer-empty-card">
                  <h3 className="univer-empty-title">
                    Ничего не найдено
                  </h3>
                  <p className="univer-empty-subtitle">
                    Попробуйте изменить запрос или проверить
                    написание фамилии.
                  </p>
                </div>
              )
            ) : (
              <div className="univer-helper-card">
                <h3 className="univer-helper-title">
                  Начните с поиска
                </h3>
                <p className="univer-helper-subtitle">
                  Введите фамилию или часть названия
                  кафедры, чтобы увидеть список
                  преподавателей.
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

