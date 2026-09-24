import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Popover } from './Popover';
import { MoreVertical } from 'lucide-react';
import { IconButton } from './IconButton';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function Menu({ items, trigger, label = 'More options' }: { items: MenuItem[]; trigger?: ReactNode; label?: string }) {
  return (
    <Popover
      align="end"
      trigger={({ onClick, ref }) =>
        trigger ? (
          <button ref={ref} onClick={onClick} aria-label={label}>
            {trigger}
          </button>
        ) : (
          <IconButton ref={ref} icon={<MoreVertical className="size-4" />} label={label} onClick={onClick} />
        )
      }
    >
      <div role="menu" className="min-w-[180px] p-1.5">
        {items.map((item, i) => (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            onClick={item.onClick}
            className={clsx(
              'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:opacity-40',
              item.danger ? 'text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10' : 'text-[var(--color-ink-1)] hover:bg-white/6 hover:text-[var(--color-ink-0)]',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </Popover>
  );
}
