import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { todayInDhaka } from "@DreamDev/db/domain/month";
import { Button } from "@DreamDev/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@DreamDev/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@DreamDev/ui/components/dropdown-menu";
import { Input } from "@DreamDev/ui/components/input";
import { Textarea } from "@DreamDev/ui/components/textarea";

import { bdMobile } from "@/api/members/schema";
import { DatePicker, isFutureDate } from "@/components/date-picker";
import { Field } from "@/components/field";
import { api } from "@/lib/api";

type Action = "edit" | "inactive" | "active" | "exited" | "remove";
type Member = { id: string; name: string; status: string };
type MemberProfile = Member & { mobile: string; joiningDate: string; address: string | null; notes: string | null };

const actionLabels: Record<Action, string> = {
  edit: "Edit member",
  inactive: "Mark inactive",
  active: "Reactivate member",
  exited: "Mark exited",
  remove: "Remove member",
};

export function MemberActions({ member, compact = false, onRemoved }: { member: Member; compact?: boolean; onRemoved?: () => void }) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const profile = useQuery({
    queryKey: ["member", member.id],
    queryFn: ({ signal }) => api<{ member: MemberProfile }>(`/api/members/${member.id}`, { signal }),
    enabled: action === "edit",
  });
  const mutation = useMutation({
    mutationFn: ({ kind, body }: { kind: Action; body?: unknown }) =>
      api(`/api/members/${member.id}${kind !== "edit" && kind !== "remove" ? "/status" : ""}`, {
        method: kind === "edit" ? "PATCH" : kind === "remove" ? "DELETE" : "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    onSuccess: async (_data, { kind }) => {
      toast.success(kind === "remove" ? "Member removed" : "Member updated");
      setAction(null);
      if (kind === "remove") onRemoved?.();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["members"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        ...(kind === "remove" ? [] : [
          queryClient.invalidateQueries({ queryKey: ["member", member.id] }),
          queryClient.invalidateQueries({ queryKey: ["position", member.id] }),
        ]),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const choose = (next: Action) => {
    mutation.reset();
    setAction(next);
  };
  const close = () => { if (!mutation.isPending) setAction(null); };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant={compact ? "ghost" : "outline"} size={compact ? "icon" : "default"} aria-label={compact ? `Actions for ${member.name}` : undefined} />}>
          <MoreHorizontalIcon data-icon="inline-start" />
          {!compact && "Member actions"}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => choose("edit")}><PencilIcon />Edit member</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Membership</DropdownMenuLabel>
            {member.status === "active" && <DropdownMenuItem onClick={() => choose("inactive")}>Mark inactive…</DropdownMenuItem>}
            {member.status === "inactive" && <DropdownMenuItem onClick={() => choose("active")}>Reactivate member…</DropdownMenuItem>}
            {member.status !== "exited" && <DropdownMenuItem onClick={() => choose("exited")}>Mark exited…</DropdownMenuItem>}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => choose("remove")}><Trash2Icon />Remove member…</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={action !== null} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className={action === "edit" ? "sm:max-w-lg" : "sm:max-w-md"}>
          <DialogHeader>
            <DialogTitle>{action ? actionLabels[action] : "Member actions"}{action === "remove" ? `: ${member.name}?` : ""}</DialogTitle>
            <DialogDescription>
              {action === "edit" ? "Update contact details and joining date. Share quantities are managed separately by an Admin."
                : action === "remove" ? "This removes the member from lists and billing. Their contributions, loans and repayment history are preserved."
                : action === "inactive" ? `Pause billing for ${member.name}. Whole months marked inactive are not billed; existing dues and loans remain.`
                : action === "active" ? `Resume membership and billing for ${member.name}.`
                : `Record when ${member.name} left the fund. Billing stops at the exit month.`}
            </DialogDescription>
          </DialogHeader>
          {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
          {action === "edit" ? (
            profile.isError ? <div className="flex flex-col gap-3"><p role="alert">Could not load member details.</p><Button variant="outline" onClick={() => profile.refetch()}>Retry</Button></div>
              : !profile.data ? <p role="status" className="text-sm text-muted-foreground">Loading member details…</p>
              : <EditMemberForm key={member.id} member={profile.data.member} pending={mutation.isPending} onCancel={close} onSubmit={(body) => mutation.mutate({ kind: "edit", body })} />
          ) : action === "remove" ? (
            <DialogFooter>
              <Button variant="outline" disabled={mutation.isPending} onClick={close}>Cancel</Button>
              <Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate({ kind: "remove" })}>{mutation.isPending ? "Removing…" : "Remove member"}</Button>
            </DialogFooter>
          ) : action ? <MembershipForm key={action} action={action} pending={mutation.isPending} onCancel={close} onSubmit={(body) => mutation.mutate({ kind: action, body })} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditMemberForm({ member, pending, onCancel, onSubmit }: { member: MemberProfile; pending: boolean; onCancel: () => void; onSubmit: (body: unknown) => void }) {
  const id = useId();
  const [name, setName] = useState(member.name);
  const [mobile, setMobile] = useState(member.mobile);
  const [joiningDate, setJoiningDate] = useState(member.joiningDate.slice(0, 10));
  const [address, setAddress] = useState(member.address ?? "");
  const [notes, setNotes] = useState(member.notes ?? "");
  const nameError = name.trim() ? undefined : "Name is required";
  const mobileError = bdMobile.test(mobile.trim()) ? undefined : "Enter a valid BD mobile (01XXXXXXXXX)";
  const joiningError = !joiningDate
    ? "Joining date is required"
    : isFutureDate(joiningDate)
      ? "Joining date can't be in the future."
      : undefined;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending || nameError || mobileError || joiningError) return;
    onSubmit({ name: name.trim(), mobile: mobile.trim(), joiningDate, address: address.trim() || null, notes: notes.trim() || null });
  };
  return (
    <form onSubmit={submit}>
      <fieldset disabled={pending} className="flex flex-col gap-4">
        <Field label="Full name" htmlFor={`${id}-name`} required error={nameError}>
          <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-invalid={Boolean(nameError)} />
        </Field>
        <Field label="Mobile" htmlFor={`${id}-mobile`} required error={mobileError}>
          <Input id={`${id}-mobile`} value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" autoComplete="tel-national" aria-invalid={Boolean(mobileError)} />
        </Field>
        <Field label="Joining date" htmlFor={`${id}-joined`} required hint="Changing this date recalculates billing from the joining month." error={joiningError}>
          <DatePicker id={`${id}-joined`} value={joiningDate} onChange={setJoiningDate} required max={todayInDhaka()} disabled={pending} />
        </Field>
        <Field label="Address" htmlFor={`${id}-address`} hint="Optional">
          <Input id={`${id}-address`} value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" />
        </Field>
        <Field label="Notes" htmlFor={`${id}-notes`} hint="Optional">
          <Textarea id={`${id}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={pending || Boolean(nameError) || Boolean(mobileError) || Boolean(joiningError)}>{pending ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </fieldset>
    </form>
  );
}

function MembershipForm({ action, pending, onCancel, onSubmit }: { action: "active" | "inactive" | "exited"; pending: boolean; onCancel: () => void; onSubmit: (body: unknown) => void }) {
  const id = useId();
  const [date, setDate] = useState(todayInDhaka());
  const [note, setNote] = useState("");
  const dateError = !date ? "Effective date is required" : isFutureDate(date) ? "Effective date can't be in the future." : undefined;
  return (
    <form onSubmit={(event) => { event.preventDefault(); if (!pending && !dateError) onSubmit({ status: action, date, note: note.trim() || undefined }); }}>
      <fieldset disabled={pending} className="flex flex-col gap-4">
        <Field label="Effective date" htmlFor={`${id}-date`} required error={dateError}>
          <DatePicker id={`${id}-date`} value={date} onChange={setDate} required max={todayInDhaka()} disabled={pending} />
        </Field>
        <Field label="Note" htmlFor={`${id}-note`} hint="Optional">
          <Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant={action === "exited" ? "destructive" : "default"} disabled={pending || Boolean(dateError)}>{pending ? "Saving…" : actionLabels[action]}</Button>
        </DialogFooter>
      </fieldset>
    </form>
  );
}
