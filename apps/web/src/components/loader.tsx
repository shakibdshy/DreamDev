import { Loader2Icon } from "lucide-react";

export default function Loader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin" aria-hidden />
      <span>{label}…</span>
    </div>
  );
}
