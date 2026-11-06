import { debounce } from "@tanstack/pacer";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { ChevronRightIcon, ImagePlusIcon, PlusIcon, SearchIcon, UserRoundIcon, UsersIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { todayInDhaka } from "@DreamDev/db/domain/month";
import { Avatar, AvatarFallback, AvatarImage } from "@DreamDev/ui/components/avatar";
import { Button } from "@DreamDev/ui/components/button";
import { Card } from "@DreamDev/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@DreamDev/ui/components/dialog";
import { Input } from "@DreamDev/ui/components/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@DreamDev/ui/components/table";
import { cn } from "@DreamDev/ui/lib/utils";

import { listMembersQuerySchema } from "@/api/members/schema";
import { Amount } from "@/components/amount";
import { EmptyState } from "@/components/empty-state";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import { firstError } from "@/lib/form-errors";
import { formatDay, initials } from "@/lib/format";
import { uploadProfilePhoto } from "@/lib/photo";

interface MemberRow {
  id: string;
  photo: string | null;
  name: string;
  mobile: string;
  joiningDate: string;
  status: string;
  shares: number;
  due: number;
  advance: number;
}

interface MembersResponse {
  data: MemberRow[];
  meta: { page: number; pageSize: number; total: number };
}

export const Route = createFileRoute("/_auth/members/")({
  validateSearch: (search: Record<string, unknown>) => {
    const parsed = listMembersQuerySchema.safeParse(search);
    return parsed.success ? parsed.data : listMembersQuerySchema.parse({});
  },
  component: MembersPage,
});

function MembersPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  // Pacer: debounce keystrokes so search doesn't hammer the API
  const onSearch = useMemo(
    () =>
      debounce((value: string) => navigate({ search: (prev) => ({ ...prev, search: value || undefined, page: 1 }) }), {
        wait: 300,
      }),
    [navigate],
  );

  const membersQuery = useQuery({
    queryKey: ["members", search],
    queryFn: () =>
      api<MembersResponse>(
        `/api/members?${new URLSearchParams(Object.entries(search).map(([k, v]) => [k, String(v)]) as [string, string][])}`,
      ),
  });

  const rows = membersQuery.data?.data ?? [];
  const total = membersQuery.data?.meta.total;
  const hasNext = membersQuery.data ? search.page * search.pageSize < membersQuery.data.meta.total : undefined;

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
      <PageHeader
        eyebrow="Fund"
        title="Members"
        description="Everyone holding a share in the fund, with their current standing."
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <PlusIcon className="size-4" />
            Add member
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 px-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search name or mobile…"
              aria-label="Search members"
              defaultValue={search.search ?? ""}
              onChange={(event) => onSearch(event.target.value)}
              className="pl-9"
            />
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {total === undefined ? "Loading…" : `${total.toLocaleString()} ${total === 1 ? "member" : "members"}`}
          </p>
        </div>

        {membersQuery.isLoading ? (
          <div className="flex flex-col gap-2 px-5 pb-2">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        ) : rows.length > 0 ? (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Member</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Shares</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Position</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Open</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((member) => (
                    <TableRow key={member.id} className="group cursor-pointer">
                      <TableCell>
                        <Link to="/members/$id" params={{ id: member.id }} search={{}} className="flex items-center gap-3">
                          <Avatar className="size-9">
                            {member.photo ? <AvatarImage src={member.photo} alt="" loading="lazy" /> : null}
                            <AvatarFallback>{initials(member.name)}</AvatarFallback>
                          </Avatar>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">{member.name}</span>
                            <span className="block text-xs text-muted-foreground tabular">{member.mobile}</span>
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDay(member.joiningDate)}</TableCell>
                      <TableCell className="text-right tabular">{member.shares}</TableCell>
                      <TableCell>
                        <StatusBadge status={member.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Position due={member.due} advance={member.advance} />
                      </TableCell>
                      <TableCell>
                        <Link to="/members/$id" params={{ id: member.id }} search={{}} aria-label={`Open ${member.name}`}>
                          <ChevronRightIcon className="size-4 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-border/70 md:hidden">
              {rows.map((member) => (
                <li key={member.id}>
                  <Link to="/members/$id" params={{ id: member.id }} search={{}} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/40">
                    <Avatar className="size-10">
                      {member.photo ? <AvatarImage src={member.photo} alt="" loading="lazy" /> : null}
                      <AvatarFallback>{initials(member.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{member.name}</p>
                      <p className="truncate text-xs text-muted-foreground tabular">{member.mobile}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Position due={member.due} advance={member.advance} />
                      <span className="text-xs text-muted-foreground">{member.shares} shares</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="px-5">
            <EmptyState
              icon={membersQuery.isError ? UserRoundIcon : UsersIcon}
              title={search.search ? `No members match “${search.search}”` : membersQuery.isError ? "Couldn't load members" : "No members yet"}
              description={
                search.search
                  ? "Try a different name or mobile number."
                  : membersQuery.isError
                    ? "Check the connection and try again."
                    : "Add the first member to start tracking shares, dues and contributions."
              }
              action={
                search.search ? (
                  <Button variant="outline" onClick={() => navigate({ search: (prev) => ({ ...prev, search: undefined, page: 1 }) })}>
                    Clear search
                  </Button>
                ) : (
                  <Button onClick={() => setCreateOpen(true)} className="gap-2">
                    <PlusIcon className="size-4" />
                    Add member
                  </Button>
                )
              }
            />
          </div>
        )}

        {rows.length > 0 && (
          <Pagination
            page={search.page}
            pageSize={search.pageSize}
            total={total}
            hasNext={hasNext}
            onPrevious={() => navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) })}
            onNext={() => navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })}
          />
        )}
      </Card>

      <CreateMemberDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function Position({ due, advance }: { due: number; advance: number }) {
  if (advance > 0) {
    return (
      <span className="flex flex-col items-end">
        <Amount value={advance} tone="neutral" className="text-info" />
        <span className="text-[11px] text-muted-foreground">advance</span>
      </span>
    );
  }
  if (due > 0) {
    return (
      <span className="flex flex-col items-end">
        <Amount value={due} tone="negative" />
        <span className="text-[11px] text-muted-foreground">due</span>
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">Settled</span>;
}

function CreateMemberDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { name: "", mobile: "", joiningDate: todayInDhaka(), shareQuantity: "1", address: "" },
    onSubmit: async ({ value }) => {
      let photo: string | undefined;
      if (photoFile) {
        try {
          photo = await uploadProfilePhoto(photoFile);
        } catch (error) {
          toast.error(`Photo skipped: ${(error as Error).message}`); // never block the save
        }
      }
      try {
        await api("/api/members", {
          method: "POST",
          body: JSON.stringify({
            name: value.name,
            mobile: value.mobile,
            joiningDate: value.joiningDate,
            shareQuantity: Number(value.shareQuantity),
            address: value.address || undefined,
            photo,
          }),
        });
        toast.success(`Added ${value.name}`);
        form.reset();
        resetPhoto();
        onOpenChange(false);
        await queryClient.invalidateQueries({ queryKey: ["members"] });
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
  });

  function resetPhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetPhoto();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a member</DialogTitle>
          <DialogDescription>Create the member and their first share allotment in one step.</DialogDescription>
        </DialogHeader>

        <form
          noValidate
          className="grid grid-cols-1 gap-5 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <form.Field name="name" validators={{ onChange: z.string().trim().min(1, "Name is required") }}>
            {(field) => (
              <Field label="Full name" htmlFor="m-name" required error={firstError(field.state.meta.errors)}>
                <Input
                  id="m-name"
                  autoComplete="name"
                  placeholder="e.g. Rahim Uddin"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="mobile" validators={{ onChange: z.string().regex(/^01[3-9]\d{8}$/, "Enter 01XXXXXXXXX") }}>
            {(field) => (
              <Field label="Mobile" htmlFor="m-mobile" required error={firstError(field.state.meta.errors)} hint="11 digits, starting 01.">
                <Input
                  id="m-mobile"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="01XXXXXXXXX"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="joiningDate" validators={{ onChange: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a joining date") }}>
            {(field) => (
              <Field label="Joining date" htmlFor="m-joined" required error={firstError(field.state.meta.errors)}>
                <Input
                  id="m-joined"
                  type="date"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="shareQuantity" validators={{ onChange: z.string().regex(/^[1-9]\d{0,2}$/, "1–100 shares") }}>
            {(field) => (
              <Field label="Shares" htmlFor="m-shares" required error={firstError(field.state.meta.errors)} hint="Can be changed later, effective from a month.">
                <Input
                  id="m-shares"
                  inputMode="numeric"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="address">
            {(field) => (
              <Field label="Address" htmlFor="m-address" className="sm:col-span-2">
                <Input
                  id="m-address"
                  autoComplete="street-address"
                  placeholder="Optional"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <div className="sm:col-span-2">
            <p className="text-sm font-medium text-foreground">Photo</p>
            <div className="mt-1.5 flex items-center gap-4 rounded-lg border border-dashed border-border bg-muted/20 p-3">
              <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full bg-muted ring-1 ring-border">
                {photoPreview ? (
                  <img src={photoPreview} alt="Selected photo preview" className="size-full object-cover" />
                ) : (
                  <ImagePlusIcon className="size-5 text-muted-foreground" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="m-photo"
                  className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border bg-card px-3 text-xs font-medium shadow-xs transition-colors hover:bg-muted"
                >
                  Choose photo
                </label>
                <input
                  id="m-photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (photoPreview) URL.revokeObjectURL(photoPreview);
                    setPhotoFile(file);
                    setPhotoPreview(file ? URL.createObjectURL(file) : null);
                  }}
                />
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {photoFile ? photoFile.name : "Optional · auto-resized to 512px"}
                </p>
              </div>
              {photoPreview && (
                <Button type="button" variant="ghost" size="sm" onClick={resetPhoto}>
                  Remove
                </Button>
              )}
            </div>
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting} className={cn(isSubmitting && "cursor-wait")}>
                  {isSubmitting ? "Adding…" : "Add member"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
