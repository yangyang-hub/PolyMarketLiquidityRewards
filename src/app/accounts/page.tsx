"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { useApi } from "@/hooks/useApi";
import type { AccountConfigDto, AccountState } from "@/types";
import StatusBadge from "@/components/StatusBadge";
import OrderTable from "@/components/OrderTable";

// --- Types ---

interface AccountForm {
  name: string;
  privateKey: string;
  signatureType: number;
  proxyWallet: string;
}

const emptyForm: AccountForm = {
  name: "",
  privateKey: "",
  signatureType: 2,
  proxyWallet: "",
};

const SIG_TYPE_LABELS: Record<number, string> = {
  0: "EOA",
  1: "Proxy",
  2: "GnosisSafe",
};

const SIG_TYPE_DESCRIPTIONS: Record<number, string> = {
  0: "直接用私钥签名",
  1: "通过代理合约签名",
  2: "Gnosis Safe 多签",
};

const NAME_RE = /^[a-zA-Z0-9_\-]{1,64}$/;
const HEX_KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const ETH_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

interface FieldErrors {
  name?: string;
  privateKey?: string;
  proxyWallet?: string;
}

function validateForm(
  form: AccountForm,
  editing: boolean,
): FieldErrors {
  const errors: FieldErrors = {};

  if (!editing) {
    const name = form.name.trim();
    if (!name) {
      errors.name = "请输入账户名称";
    } else if (!NAME_RE.test(name)) {
      errors.name = "仅支持字母、数字、下划线和连字符，1-64 位";
    }
  }

  const pk = form.privateKey.trim();
  if (!editing && !pk) {
    errors.privateKey = "请输入私钥";
  } else if (pk) {
    if (!pk.startsWith("0x")) {
      errors.privateKey = "私钥需以 0x 开头";
    } else if (!HEX_KEY_RE.test(pk)) {
      errors.privateKey = "私钥格式不正确，需要 0x + 64 位十六进制字符";
    }
  }

  if ((form.signatureType === 1 || form.signatureType === 2) && form.proxyWallet.trim()) {
    if (!ETH_ADDR_RE.test(form.proxyWallet.trim())) {
      errors.proxyWallet = "地址格式不正确，需要 0x + 40 位十六进制字符";
    }
  }

  return errors;
}

// --- Icons (inline SVG helpers) ---

function IconUser({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

function IconPlus({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

function IconPencil({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function IconTrash({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function IconKey({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
    </svg>
  );
}

function IconShield({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function IconWallet({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  );
}

// --- Account Card Component ---

function AccountCardItem({
  name,
  account,
  cfg,
  onEdit,
  onDelete,
  onStart,
  onStop,
}: {
  name: string;
  account?: AccountState;
  cfg?: AccountConfigDto;
  onEdit: () => void;
  onDelete: () => void;
  onStart: () => void;
  onStop: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasOrders = account && account.activeOrders.length > 0;

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300 transition-shadow hover:shadow-md">
      <div className="card-body p-0">
        {/* Card Header */}
        <div className="flex items-center justify-between p-4 pb-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <IconUser className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold truncate">{name}</h3>
                {account && <StatusBadge status={account.status} />}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-mono opacity-50 truncate">
                  {account?.address
                    ? `${account.address.slice(0, 6)}...${account.address.slice(-4)}`
                    : "..."}
                </span>
                {cfg && (
                  <span className="badge badge-ghost badge-xs">
                    {SIG_TYPE_LABELS[cfg.signatureType] ?? `sig:${cfg.signatureType}`}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {cfg && (
              <>
                <button
                  className="btn btn-ghost btn-xs btn-square tooltip tooltip-bottom"
                  data-tip="编辑"
                  onClick={onEdit}
                >
                  <IconPencil />
                </button>
                <button
                  className="btn btn-ghost btn-xs btn-square text-error tooltip tooltip-bottom"
                  data-tip="删除"
                  onClick={onDelete}
                >
                  <IconTrash />
                </button>
                <div className="divider divider-horizontal mx-0.5 h-5" />
              </>
            )}
            {account && account.status === "running" ? (
              <button
                className="btn btn-warning btn-outline btn-xs"
                onClick={onStop}
              >
                停止
              </button>
            ) : account ? (
              <button
                className="btn btn-primary btn-xs"
                onClick={onStart}
                disabled={account.status === "stopping"}
              >
                启动
              </button>
            ) : null}
          </div>
        </div>

        {/* Stats Row */}
        {account && (
          <div className="px-4 pt-3">
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-base-200/60 rounded-lg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider opacity-40">余额</div>
                <div className="text-sm font-mono font-semibold mt-0.5">
                  ${account.balance.toFixed(2)}
                </div>
              </div>
              <div className="bg-base-200/60 rounded-lg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider opacity-40">挂单</div>
                <div className="text-sm font-mono font-semibold mt-0.5">
                  {account.activeOrders.length}
                </div>
              </div>
              <div className="bg-base-200/60 rounded-lg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider opacity-40">市场</div>
                <div className="text-sm font-mono font-semibold mt-0.5">
                  {account.marketsCount}
                </div>
              </div>
              <div className="bg-base-200/60 rounded-lg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider opacity-40">更新</div>
                <div className="text-sm font-mono font-semibold mt-0.5">
                  {account.lastUpdate
                    ? new Date(account.lastUpdate).toLocaleTimeString()
                    : "—"}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {account?.error && (
          <div className="px-4 pt-2">
            <div className="text-xs text-error bg-error/10 rounded-lg px-3 py-2">
              {account.error}
            </div>
          </div>
        )}

        {/* Orders Section (collapsible) */}
        {account && (
          <div className="px-4 py-3">
            {hasOrders ? (
              <>
                <button
                  className="btn btn-ghost btn-xs gap-1 opacity-60 hover:opacity-100 -ml-1"
                  onClick={() => setExpanded(!expanded)}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  {account.activeOrders.length} 笔活跃订单
                </button>
                {expanded && (
                  <div className="mt-2">
                    <OrderTable orders={account.activeOrders} />
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs opacity-40 text-center py-1">暂无活跃订单</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main Page ---

export default function AccountsPage() {
  const accounts = useAppStore((s) => s.accounts);
  const accountConfigs = useAppStore((s) => s.accountConfigs);
  const setAccountConfigs = useAppStore((s) => s.setAccountConfigs);
  const { get, post, put, del } = useApi();

  const [form, setForm] = useState<AccountForm>(emptyForm);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [editingName, setEditingName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const modalRef = useRef<HTMLDialogElement>(null);
  const deleteModalRef = useRef<HTMLDialogElement>(null);

  const fieldErrors = validateForm(form, !!editingName);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  const markTouched = (field: string) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  // Only show error for a field after user has interacted with it
  const fieldError = (field: keyof FieldErrors) =>
    touched[field] ? fieldErrors[field] : undefined;

  // Load configs on mount
  useEffect(() => {
    get<{ configs: AccountConfigDto[] }>("/api/accounts").then((res) => {
      if (res.configs) setAccountConfigs(res.configs);
    });
  }, [get, setAccountConfigs]);

  const refreshConfigs = async () => {
    const res = await get<{ configs: AccountConfigDto[] }>("/api/accounts");
    if (res.configs) setAccountConfigs(res.configs);
  };

  const openAddModal = () => {
    setForm(emptyForm);
    setTouched({});
    setEditingName(null);
    setError("");
    setShowPassword(false);
    modalRef.current?.showModal();
  };

  const openEditModal = (cfg: AccountConfigDto) => {
    setForm({
      name: cfg.name,
      privateKey: "",
      signatureType: cfg.signatureType,
      proxyWallet: cfg.proxyWallet || "",
    });
    setTouched({});
    setEditingName(cfg.name);
    setError("");
    setShowPassword(false);
    modalRef.current?.showModal();
  };

  const handleSubmit = async () => {
    // Touch all fields to surface validation
    setTouched({ name: true, privateKey: true, proxyWallet: true });
    const errors = validateForm(form, !!editingName);
    if (Object.keys(errors).length > 0) return;

    setError("");
    setLoading(true);
    try {
      if (editingName) {
        await put(`/api/accounts/${encodeURIComponent(editingName)}`, {
          privateKey: form.privateKey.trim() || undefined,
          signatureType: form.signatureType,
          proxyWallet: form.proxyWallet.trim() || undefined,
        });
      } else {
        await post("/api/accounts", {
          name: form.name.trim(),
          privateKey: form.privateKey.trim(),
          signatureType: form.signatureType,
          proxyWallet: form.proxyWallet.trim() || undefined,
        });
      }
      modalRef.current?.close();
      await refreshConfigs();
    } catch (e: any) {
      setError(e.message || "操作失败");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError("");
    setLoading(true);
    try {
      await del(`/api/accounts/${encodeURIComponent(deleteTarget)}`);
      deleteModalRef.current?.close();
      setDeleteTarget(null);
      await refreshConfigs();
    } catch (e: any) {
      setDeleteError(e.message || "删除失败");
    } finally {
      setLoading(false);
    }
  };

  const getConfigForAccount = (name: string) =>
    accountConfigs.find((c) => c.name === name);

  // Merge account names from both sources, deduplicated, ordered
  const allNames = [
    ...new Set([
      ...accountConfigs.map((c) => c.name),
      ...accounts.map((a) => a.name),
    ]),
  ];

  const showNeedsProxy = form.signatureType === 1 || form.signatureType === 2;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">账户管理</h2>
          <p className="text-sm opacity-50 mt-1">
            管理做市账户的私钥、签名类型与代理钱包配置
          </p>
        </div>
        <button className="btn btn-primary btn-sm gap-1" onClick={openAddModal}>
          <IconPlus className="h-3.5 w-3.5" />
          添加账户
        </button>
      </div>

      {/* Empty State */}
      {allNames.length === 0 ? (
        <div className="card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body items-center text-center py-16">
            <div className="w-16 h-16 rounded-full bg-base-200 flex items-center justify-center mb-4">
              <IconUser className="h-8 w-8 opacity-30" />
            </div>
            <h3 className="font-semibold text-lg">暂无账户</h3>
            <p className="text-sm opacity-50 max-w-xs mt-1">
              添加做市账户以开始自动挂单。私钥使用 AES-256-GCM 加密存储在本地数据库中。
            </p>
            <button
              className="btn btn-primary btn-sm gap-1 mt-4"
              onClick={openAddModal}
            >
              <IconPlus className="h-3.5 w-3.5" />
              添加第一个账户
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {allNames.map((name) => {
            const account = accounts.find((a) => a.name === name);
            const cfg = getConfigForAccount(name);
            return (
              <AccountCardItem
                key={name}
                name={name}
                account={account}
                cfg={cfg}
                onEdit={() => cfg && openEditModal(cfg)}
                onDelete={() => {
                  setDeleteTarget(name);
                  setDeleteError("");
                  deleteModalRef.current?.showModal();
                }}
                onStart={() => post(`/api/accounts/${encodeURIComponent(name)}/start`)}
                onStop={() => post(`/api/accounts/${encodeURIComponent(name)}/stop`)}
              />
            );
          })}
        </div>
      )}

      {/* ── Add/Edit Modal ── */}
      <dialog ref={modalRef} className="modal">
        <div className="modal-box max-w-md">
          {/* Modal Header */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              {editingName
                ? <IconPencil className="h-4 w-4 text-primary" />
                : <IconPlus className="h-4 w-4 text-primary" />}
            </div>
            <div>
              <h3 className="font-bold text-lg leading-tight">
                {editingName ? "编辑账户" : "添加账户"}
              </h3>
              {editingName && (
                <p className="text-xs opacity-50 mt-0.5">{editingName}</p>
              )}
            </div>
          </div>

          {/* Server Error */}
          {error && (
            <div className="alert alert-error text-sm mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              {error}
            </div>
          )}

          {/* Form */}
          <form
            onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
            className="space-y-4"
          >
            {/* ── Name ── */}
            {!editingName && (
              <div className="form-control">
                <label className="label pb-1">
                  <span className="label-text flex items-center gap-1.5 text-sm">
                    <IconUser className="h-3.5 w-3.5 opacity-50" />
                    账户名称
                  </span>
                </label>
                <input
                  type="text"
                  className={`input input-bordered w-full ${
                    fieldError("name")
                      ? "input-error"
                      : touched.name && !fieldErrors.name
                        ? "input-success"
                        : ""
                  }`}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  onBlur={() => markTouched("name")}
                  placeholder="例如 main, bot-1"
                  autoFocus
                  autoComplete="off"
                />
                {fieldError("name") ? (
                  <label className="label pt-1 pb-0">
                    <span className="label-text-alt text-error">{fieldError("name")}</span>
                  </label>
                ) : (
                  <label className="label pt-1 pb-0">
                    <span className="label-text-alt opacity-40">
                      字母、数字、下划线、连字符，1-64 位
                    </span>
                  </label>
                )}
              </div>
            )}

            {/* ── Private Key ── */}
            <div className="form-control">
              <label className="label pb-1">
                <span className="label-text flex items-center gap-1.5 text-sm">
                  <IconKey className="h-3.5 w-3.5 opacity-50" />
                  私钥
                  {editingName && (
                    <span className="badge badge-ghost badge-xs ml-0.5">可选</span>
                  )}
                </span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  className={`input input-bordered font-mono w-full pr-10 ${
                    fieldError("privateKey")
                      ? "input-error"
                      : touched.privateKey && form.privateKey.trim() && !fieldErrors.privateKey
                        ? "input-success"
                        : ""
                  }`}
                  value={form.privateKey}
                  onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
                  onBlur={() => markTouched("privateKey")}
                  placeholder="0x..."
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-square absolute right-1.5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              {fieldError("privateKey") ? (
                <label className="label pt-1 pb-0">
                  <span className="label-text-alt text-error">{fieldError("privateKey")}</span>
                </label>
              ) : (
                <label className="label pt-1 pb-0">
                  <span className="label-text-alt opacity-40 flex items-center gap-1">
                    <IconShield className="h-3 w-3" />
                    {editingName ? "留空则保留原密钥" : "AES-256-GCM 加密存储"}
                  </span>
                </label>
              )}
            </div>

            {/* ── Signature Type ── */}
            <div className="form-control">
              <label className="label pb-1">
                <span className="label-text flex items-center gap-1.5 text-sm">
                  <IconShield className="h-3.5 w-3.5 opacity-50" />
                  签名类型
                </span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {([0, 1, 2] as const).map((val) => (
                  <label
                    key={val}
                    className={`flex flex-col items-center gap-0.5 p-2.5 rounded-lg border cursor-pointer transition-all ${
                      form.signatureType === val
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-base-300 opacity-50 hover:opacity-75 hover:border-base-content/20"
                    }`}
                  >
                    <input
                      type="radio"
                      className="hidden"
                      name="signatureType"
                      value={val}
                      checked={form.signatureType === val}
                      onChange={() => setForm({ ...form, signatureType: val })}
                    />
                    <span className={`text-sm ${form.signatureType === val ? "font-semibold" : ""}`}>
                      {SIG_TYPE_LABELS[val]}
                    </span>
                    <span className="text-[10px] leading-tight opacity-60 text-center">
                      {SIG_TYPE_DESCRIPTIONS[val]}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* ── Proxy Wallet (conditional) ── */}
            {showNeedsProxy && (
              <div className="form-control">
                <label className="label pb-1">
                  <span className="label-text flex items-center gap-1.5 text-sm">
                    <IconWallet className="h-3.5 w-3.5 opacity-50" />
                    代理钱包地址
                  </span>
                </label>
                <input
                  type="text"
                  className={`input input-bordered font-mono w-full ${
                    fieldError("proxyWallet")
                      ? "input-error"
                      : touched.proxyWallet && form.proxyWallet.trim() && !fieldErrors.proxyWallet
                        ? "input-success"
                        : ""
                  }`}
                  value={form.proxyWallet}
                  onChange={(e) => setForm({ ...form, proxyWallet: e.target.value })}
                  onBlur={() => markTouched("proxyWallet")}
                  placeholder="0x..."
                  autoComplete="off"
                  spellCheck={false}
                />
                {fieldError("proxyWallet") ? (
                  <label className="label pt-1 pb-0">
                    <span className="label-text-alt text-error">{fieldError("proxyWallet")}</span>
                  </label>
                ) : (
                  <label className="label pt-1 pb-0">
                    <span className="label-text-alt opacity-40">
                      Polymarket 代理钱包的以太坊地址
                    </span>
                  </label>
                )}
              </div>
            )}

            {/* ── Actions ── */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => modalRef.current?.close()}
              >
                取消
              </button>
              <button
                type="submit"
                className="btn btn-primary gap-1"
                disabled={loading || hasFieldErrors}
              >
                {loading ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : editingName ? (
                  <>
                    <IconPencil className="h-3.5 w-3.5" />
                    保存修改
                  </>
                ) : (
                  <>
                    <IconPlus className="h-3.5 w-3.5" />
                    添加
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>

      {/* ── Delete Confirmation Modal ── */}
      <dialog ref={deleteModalRef} className="modal">
        <div className="modal-box max-w-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
              <IconTrash className="h-4 w-4 text-error" />
            </div>
            <div>
              <h3 className="font-bold text-lg leading-tight">确认删除</h3>
              <p className="text-xs opacity-50">此操作不可撤销</p>
            </div>
          </div>
          <p className="text-sm">
            确定要删除账户 <span className="font-semibold text-error">{deleteTarget}</span> 吗？
            运行中的账户将先被停止，所有关联的加密密钥数据将被永久移除。
          </p>
          {deleteError && (
            <div className="alert alert-error text-sm mt-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              {deleteError}
            </div>
          )}
          <div className="modal-action">
            <form method="dialog">
              <button className="btn btn-ghost btn-sm">取消</button>
            </form>
            <button
              className="btn btn-error btn-sm gap-1"
              onClick={handleDelete}
              disabled={loading}
            >
              {loading ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <>
                  <IconTrash className="h-3.5 w-3.5" />
                  确认删除
                </>
              )}
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}
