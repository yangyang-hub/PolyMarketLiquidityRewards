"use client";

import Link from "next/link";

function DisclosurePanel({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "primary" | "warning" | "positive";
  children: React.ReactNode;
}) {
  const toneClass = {
    primary: "text-[var(--terminal-primary-text)]",
    warning: "text-[var(--terminal-warning)]",
    positive: "terminal-positive",
  }[tone];

  return (
    <section className="terminal-panel p-6">
      <h2 className={`mb-4 text-[26px] font-semibold ${toneClass}`}>{title}</h2>
      <div className="text-[16px] leading-7 text-[var(--terminal-text)]">{children}</div>
    </section>
  );
}

export default function RiskDisclosurePage() {
  return (
    <div className="grid h-full grid-cols-[34%_1fr] overflow-hidden bg-[var(--terminal-bg)]">
      <aside className="flex flex-col justify-center border-r border-[var(--terminal-border-strong)] bg-[#1b1e28] p-8">
        <div className="mb-8 text-[72px] leading-none text-[var(--terminal-warning)]">⚠</div>
        <h1 className="mb-6 text-[38px] font-semibold text-[var(--terminal-warning)]">重要风险提示</h1>
        <p className="max-w-[460px] text-[18px] leading-7 text-[var(--terminal-muted)]">
          你正在初始化高频交易风控终端。继续前必须确认理解本地密钥、自动恢复和网络连接带来的真实订单风险。
        </p>
        <div className="mt-12 border border-[rgba(255,179,178,0.35)] bg-[rgba(255,179,178,0.12)] px-3 py-2 terminal-label text-[var(--terminal-warning)]">
          ● 系统已暂停，等待确认
        </div>
      </aside>

      <main className="flex flex-col overflow-hidden">
        <div className="flex-1 space-y-8 overflow-auto p-8">
          <DisclosurePanel title="本地密钥管理" tone="primary">
            <p>
              本工具读取本地加密私钥以完成交易授权。私钥不会上传到项目服务器，但你需要自行负责主机、磁盘和运行环境安全。
            </p>
            <ul className="mt-4 list-disc space-y-2 pl-6 text-[var(--terminal-muted)]">
              <li>确保本地磁盘已启用加密。</li>
              <li>不要在共享或公共工作站上运行。</li>
            </ul>
          </DisclosurePanel>

          <DisclosurePanel title="自动恢复协议" tone="warning">
            <p>
              自动恢复会在网络断开或应用重启后尝试恢复上次启用账户。
              <strong className="text-[var(--terminal-warning)]"> 自动恢复会影响真实订单 </strong>
              ，可能在剧烈波动期间触发撤单或重挂。
            </p>
            <div className="mt-4 border border-[var(--terminal-border-strong)] bg-[var(--terminal-panel-soft)] p-3 terminal-data terminal-muted">
              &gt; 系统.自动恢复 = 开启<br />
              &gt; 执行.模式 = 激进校准
            </div>
          </DisclosurePanel>

          <DisclosurePanel title="网络要求" tone="positive">
            <p>
              稳定、低延迟的预测市场订单簿连接是正常运行的必要条件。网络降级会影响订单簿同步、撤单确认和风险触发时效。
            </p>
          </DisclosurePanel>
        </div>

        <div className="flex justify-end gap-3 border-t border-[var(--terminal-border-strong)] bg-[var(--terminal-surface)] p-4">
          <Link href="/" className="terminal-action">
            进入应用
          </Link>
          <Link href="/" className="terminal-action primary">
            进入并启用自动恢复
          </Link>
        </div>
      </main>
    </div>
  );
}
