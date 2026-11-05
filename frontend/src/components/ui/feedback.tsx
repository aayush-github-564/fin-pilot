import { AlertCircle, LoaderCircle } from "lucide-react";

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-slate-600" role="status">
      <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-cyan-700" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorMessage({ children }: { children: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-800"
      role="alert"
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
