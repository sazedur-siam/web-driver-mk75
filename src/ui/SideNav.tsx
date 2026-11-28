import { useEffect, useRef, type ReactNode } from 'react';

/** Sections of the app, grouped the way the sidebar shows them. Order here is the order on screen. */
export const NAV_GROUPS = [
  { title: null, tabs: ['Profiles'] },
  { title: 'Lighting', tabs: ['Lighting', 'Per-key RGB', 'Side lights', 'Live effects'] },
  { title: 'Keys', tabs: ['Key mapping', 'Macros', 'Key tester'] },
  { title: 'Keyboard', tabs: ['Device', 'Backup & log'] },
] as const;

export type Tab = (typeof NAV_GROUPS)[number]['tabs'][number];
export const TABS: readonly Tab[] = NAV_GROUPS.flatMap((g) => g.tabs);

/** Line icons on a 24-unit grid, drawn in currentColor. */
const ICONS: Record<Tab, ReactNode> = {
  Profiles: (
    <>
      <path d="M12 3 3 8l9 5 9-5-9-5z" />
      <path d="m3 12.5 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </>
  ),
  Lighting: (
    <>
      <path d="M9 18h6M10 21.5h4" />
      <path d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.5.4.8 1 .8 1.7v.5h6v-.5c0-.7.3-1.3.8-1.7A6.5 6.5 0 0 0 12 2.5z" />
    </>
  ),
  'Per-key RGB': (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.8" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.8" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.8" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.8" />
    </>
  ),
  'Side lights': (
    <>
      <rect x="6.5" y="6" width="11" height="12" rx="2.2" />
      <path d="M2.5 8.5v7M21.5 8.5v7" />
    </>
  ),
  'Live effects': <path d="M2.5 12h4l3-7.5 5 15 3-7.5h4" />,
  'Key mapping': (
    <>
      <rect x="2" y="5.5" width="20" height="13" rx="2.2" />
      <path d="M6 9.5h.01M10 9.5h.01M14 9.5h.01M18 9.5h.01M6 12.5h.01M18 12.5h.01M8 15h8" />
    </>
  ),
  Macros: (
    <>
      <path d="M3.5 6h11M3.5 11h11M3.5 16h6" />
      <path d="m15 14 6.5 3.5L15 21z" />
    </>
  ),
  'Key tester': (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.8" />
    </>
  ),
  Device: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5" />
    </>
  ),
  'Backup & log': (
    <>
      <rect x="2.5" y="4" width="19" height="4.5" rx="1.2" />
      <path d="M4.5 8.5v10a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-10M10 12.5h4" />
    </>
  ),
};

/**
 * App navigation. CSS picks the shape: a labelled sidebar on wide screens, an icon rail in between,
 * and a scrolling strip on narrow ones. `active` is null while the Guide covers the tabs.
 */
export function SideNav({ active, onSelect }: { active: Tab | null; onSelect: (t: Tab) => void }) {
  const ref = useRef<HTMLElement>(null);
  // On narrow screens the nav is a sideways-scrolling strip: keep the open section in view.
  useEffect(() => {
    ref.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  return (
    <nav className="sidenav" aria-label="Sections" ref={ref}>
      {NAV_GROUPS.map((g, i) => (
        <div className="sidenav-group" key={g.title ?? i} role="group" aria-label={g.title ?? undefined}>
          {g.title && (
            <div className="sidenav-title" aria-hidden>
              {g.title}
            </div>
          )}
          {g.tabs.map((t) => (
            <button
              key={t}
              className={active === t ? 'on' : ''}
              aria-current={active === t ? 'page' : undefined}
              onClick={() => onSelect(t)}
              title={t}
            >
              <svg className="sidenav-icon" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                {ICONS[t]}
              </svg>
              <span className="sidenav-label">{t}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
