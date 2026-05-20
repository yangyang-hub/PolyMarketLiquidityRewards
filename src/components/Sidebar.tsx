"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  {
    href: "/",
    label: "仪表盘",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z" />
    ),
  },
  {
    href: "/accounts",
    label: "账户",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2m14-10a4 4 0 10-8 0 4 4 0 008 0zm4 10v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    ),
  },
  {
    href: "/settings",
    label: "设置",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15.5A3.5 3.5 0 1112 8a3.5 3.5 0 010 7.5zm7.4-2.1a1.8 1.8 0 000-2.8l-1.3-1a7.5 7.5 0 00-.7-1.7l.2-1.6a1.8 1.8 0 00-2-2l-1.6.2a7.5 7.5 0 00-1.7-.7l-1-1.3a1.8 1.8 0 00-2.8 0l-1 1.3a7.5 7.5 0 00-1.7.7l-1.6-.2a1.8 1.8 0 00-2 2l.2 1.6a7.5 7.5 0 00-.7 1.7l-1.3 1a1.8 1.8 0 000 2.8l1.3 1a7.5 7.5 0 00.7 1.7l-.2 1.6a1.8 1.8 0 002 2l1.6-.2a7.5 7.5 0 001.7.7l1 1.3a1.8 1.8 0 002.8 0l1-1.3a7.5 7.5 0 001.7-.7l1.6.2a1.8 1.8 0 002-2l-.2-1.6a7.5 7.5 0 00.7-1.7l1.3-1z" />
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="terminal-sidebar hidden flex-col py-4 md:flex">
      <div className="px-5 pb-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--terminal-panel-high)] text-[var(--terminal-muted)]">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="truncate text-[18px] font-bold text-[var(--terminal-primary-text)]">
              流动性风控终端
            </div>
            <div className="terminal-label">当前会话</div>
          </div>
        </div>
        <Link href="/accounts" className="terminal-action primary w-full">
          开始交易
        </Link>
      </div>

      <nav className="flex-1 px-2">
        <ul className="flex flex-col gap-1">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 px-5 py-3 text-[12px] font-bold tracking-[0.05em] transition-colors ${
                    active
                      ? "border-r-2 border-[var(--terminal-primary-text)] bg-[var(--terminal-primary-soft)] text-[var(--terminal-primary-text)]"
                      : "text-[var(--terminal-muted)] hover:bg-[var(--terminal-panel-high)] hover:text-[var(--terminal-text)]"
                  }`}
                >
                  <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {item.icon}
                  </svg>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
