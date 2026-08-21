import { NavLink, Outlet } from 'react-router-dom';
import { RECRUITMENT_NAV } from './nav.js';

// The department shell. On desktop the pages live in the sidebar (Sidebar.jsx
// swaps to Recruitment's nav inside /recruitment); on a phone the sidebar is
// not there, so the same pages ride along the top.
export default function RecruitmentLayout() {
  return (
    <div>
      <div className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4 pb-1 md:hidden">
        {RECRUITMENT_NAV.map(item => (
          <NavLink key={item.id} to={item.to} end={item.end}
            className={({ isActive }) => `shrink-0 rounded-full px-3.5 py-2 text-[12px] font-semibold ${isActive ? 'bg-[var(--color-ink)] text-white' : 'bg-white border border-[var(--color-line)] text-[var(--color-ink-soft)]'}`}>
            {item.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
