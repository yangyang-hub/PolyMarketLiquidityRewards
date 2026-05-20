"use client";

const steps = [
  { label: "启动本地服务", status: "完成", state: "done" },
  { label: "初始化数据库 ...", status: "处理中", state: "active" },
  { label: "连接预测市场订单簿", status: "等待", state: "pending" },
];

export default function StartupPage() {
  return (
    <div className="flex h-full items-center justify-center bg-[var(--terminal-bg)]">
      <div className="w-[520px] text-center">
        <div className="mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded border border-[var(--terminal-border-strong)] bg-[var(--terminal-panel-high)] text-[var(--terminal-primary-text)]">
          <svg className="h-9 w-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 17l5-5 4 4 7-9M4 20h16" />
          </svg>
        </div>
        <h1 className="text-[40px] font-semibold leading-none">流动性风控终端</h1>
        <p className="mt-3 text-[16px] text-[var(--terminal-muted)]">高频盘口风控桌面端</p>

        <section className="terminal-panel mt-14 p-5 text-left">
          <div className="mb-5 h-1 border border-[var(--terminal-border)] bg-[var(--terminal-panel-high)]">
            <div className="h-full w-[65%] bg-[var(--terminal-primary-text)]" />
          </div>
          <div className="space-y-3">
            {steps.map((step) => (
              <div key={step.label} className="grid grid-cols-[24px_1fr_72px] items-center gap-3 terminal-data">
                <span className={step.state === "done" ? "terminal-positive" : step.state === "active" ? "text-[var(--terminal-primary-text)]" : "terminal-dim"}>
                  {step.state === "done" ? "◎" : step.state === "active" ? "↻" : "◷"}
                </span>
                <span className={step.state === "pending" ? "terminal-dim" : ""}>{step.label}</span>
                <span className={`text-right ${step.state === "done" ? "terminal-positive" : step.state === "active" ? "text-[var(--terminal-primary-text)]" : "terminal-dim"}`}>
                  {step.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
