import clsx from 'clsx'
import type { Subgroup } from '../../store/userStore'

const OPTIONS: Array<{ value: Subgroup; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
]

type SubgroupToggleProps = {
  value: Subgroup
  onChange: (subgroup: Subgroup) => void | Promise<void>
  ariaLabel?: string
  className?: string
  buttonClassName?: string
}

export const SubgroupToggle = ({
  value,
  onChange,
  ariaLabel = 'Выбор подгруппы',
  className,
  buttonClassName,
}: SubgroupToggleProps) => (
  <div
    className={clsx('subgroup-toggle', className)}
    role="radiogroup"
    aria-label={ariaLabel}
  >
    {OPTIONS.map((option) => {
      const isActive = value === option.value

      return (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={isActive}
          className={clsx(
            'subgroup-toggle-button',
            buttonClassName,
            isActive && 'subgroup-toggle-button--active',
          )}
          onClick={() => {
            if (!isActive) {
              void onChange(option.value)
            }
          }}
        >
          {option.label}
        </button>
      )
    })}
  </div>
)
