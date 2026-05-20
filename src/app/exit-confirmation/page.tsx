"use client";

import Link from "next/link";

export default function ExitConfirmationPage() {
  return (
    <div className="flex h-full items-center justify-center bg-[rgba(12,14,23,0.94)]">
      <section className="w-[480px] border border-[var(--terminal-border-strong)] bg-[var(--terminal-panel-high)]">
        <div className="flex h-12 items-center justify-between border-b border-[var(--terminal-border-strong)] bg-[var(--terminal-panel-soft)] px-5">
          <div className="flex items-center gap-3 text-[24px] font-semibold">
            <span className="text-[var(--terminal-primary-text)]">⏻</span>
            退出会话
          </div>
          <Link href="/" className="terminal-muted text-[24px] leading-none">
            ×
          </Link>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <h1 className="mb-5 text-[20px] font-semibold">是否保持后台交易？</h1>
            <p className="text-[15px] leading-6 text-[var(--terminal-muted)]">
              流动性风控终端可以最小化到系统托盘，保持账户连接和后台风控任务运行。
            </p>
          </div>

          <div className="space-y-2">
            <button className="terminal-action primary w-full">最小化到托盘</button>
            <button className="terminal-action danger w-full">停止账户并退出</button>
            <button className="terminal-action w-full">直接退出</button>
          </div>
        </div>

        <div className="border-t border-[var(--terminal-border-strong)] bg-[var(--terminal-surface)] px-5 py-3">
          <label className="flex items-center gap-3 terminal-data terminal-muted">
            <input type="checkbox" className="checkbox checkbox-xs rounded-none border-[var(--terminal-border-strong)]" />
            不再询问
          </label>
        </div>
      </section>
    </div>
  );
}
