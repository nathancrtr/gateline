import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet } from 'react-router-dom'
import { api } from './api.ts'
import { useLiveInvalidation } from './use-live.ts'

function NavItem({ to, label, badge, end }: { to: string; label: string; badge?: number; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-[9px] rounded-[4px] px-[9px] py-[7px] text-xs transition-colors duration-[140ms] ${
          isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-ink'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              isActive ? 'bg-accent shadow-[0_0_8px_var(--glow)]' : 'bg-faint'
            }`}
          />
          <span className="flex-1">{label}</span>
          {badge !== undefined && badge > 0 && (
            <span className="pulse-glow rounded-full bg-accent px-1.5 py-px font-mono text-[11px] font-semibold tabular-nums text-on-solid">
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

export function App() {
  useLiveInvalidation()
  const inbox = useQuery({ queryKey: ['inbox'], queryFn: api.inbox })
  const needs = inbox.data?.items.length

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl">
      <aside className="sticky top-0 flex h-dvh w-48 shrink-0 flex-col gap-[22px] border-r border-line bg-surface px-3 py-4 max-md:hidden">
        <div className="px-2 py-1.5">
          <span className="font-mono text-[15px] font-semibold uppercase leading-none tracking-[0.16em]">Gate</span>
          <p className="mt-1.5 text-[10.5px] leading-[1.35] text-faint">pipeline decisions</p>
        </div>
        <nav className="flex flex-col gap-0.5">
          <NavItem to="/" label="Inbox" badge={needs} end />
          <NavItem to="/portfolio" label="Portfolio" />
          <NavItem to="/metrics" label="Metrics" />
        </nav>
        <div className="mt-auto p-2 font-mono text-[10px] leading-[1.6] text-faint">
          The repo is the database.
          <br />
          Every view renders git.
        </div>
      </aside>

      {/* Mobile top nav */}
      <div className="fixed inset-x-0 top-0 z-10 flex items-center gap-1 border-b border-line bg-ground/90 px-3 py-2 backdrop-blur md:hidden">
        <span className="mr-2 font-mono text-[15px] font-semibold uppercase leading-none tracking-[0.16em]">Gate</span>
        <NavItem to="/" label="Inbox" badge={needs} end />
        <NavItem to="/portfolio" label="Portfolio" />
        <NavItem to="/metrics" label="Metrics" />
      </div>

      <main className="min-w-0 flex-1 px-6 py-6 max-md:pt-16">
        <Outlet />
      </main>
    </div>
  )
}
