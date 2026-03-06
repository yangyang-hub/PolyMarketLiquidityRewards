"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppStore } from "@/stores/appStore";

const navItems = [
  { href: "/", label: "仪表盘", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { href: "/markets", label: "奖励市场", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { href: "/accounts", label: "账户管理", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" },
  { href: "/settings", label: "策略设置", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const systemStatus = useAppStore((s) => s.systemStatus);
  const wsConnected = useAppStore((s) => s.wsConnected);

  return (
    <aside className="w-64 bg-base-200 min-h-screen flex flex-col">
      <div className="p-4 border-b border-base-300">
        <h1 className="text-lg font-bold">PolyMarket LR</h1>
        <p className="text-xs opacity-60">流动性挖矿做市</p>
      </div>

      <nav className="flex-1 p-2">
        <ul className="menu">
          {navItems.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={pathname === item.href ? "active" : ""}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={item.icon}
                  />
                </svg>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="p-4 border-t border-base-300 text-xs space-y-1">
        <div className="flex items-center gap-2">
          <span
            className={`badge badge-xs ${wsConnected ? "badge-success" : "badge-error"}`}
          />
          <span>WS {wsConnected ? "已连接" : "已断开"}</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`badge badge-xs ${systemStatus.wsConnected ? "badge-success" : "badge-warning"}`}
          />
          <span>CLOB 数据源 {systemStatus.wsConnected ? "在线" : "离线"}</span>
        </div>
        <div className="opacity-60">
          {systemStatus.totalAccounts} 个账户 | {systemStatus.totalMarkets} 个市场
        </div>
      </div>
    </aside>
  );
}
