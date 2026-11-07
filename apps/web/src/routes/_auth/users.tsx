import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { KeyRoundIcon, MoreHorizontalIcon, PlusIcon, ShieldCheckIcon, ShieldOffIcon, UserCogIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@DreamDev/ui/components/badge";
import { Button } from "@DreamDev/ui/components/button";
import { Card } from "@DreamDev/ui/components/card";
import { Avatar, AvatarFallback } from "@DreamDev/ui/components/avatar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@DreamDev/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@DreamDev/ui/components/dropdown-menu";
import { Input } from "@DreamDev/ui/components/input";
import { NativeSelect } from "@DreamDev/ui/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@DreamDev/ui/components/table";
import { Skeleton } from "@DreamDev/ui/components/skeleton";

import { listUsersQuerySchema } from "@/api/users/schema";
import type { UserListItem } from "@/api/users/service";
import { EmptyState } from "@/components/empty-state";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import { firstError } from "@/lib/form-errors";
import { formatDateTime, formatDay, initials } from "@/lib/format";

/** Wire shape: dates arrive as ISO strings over JSON. */
interface UserRowData extends Omit<UserListItem, "createdAt" | "lastSignInAt"> {
  createdAt: string;
  lastSignInAt: string | null;
}

interface UsersResponse {
  data: UserRowData[];
  meta: { page: number; pageSize: number; total: number };
}

export const Route = createFileRoute("/_auth/users")({
  validateSearch: (search: Record<string, unknown>) => {
    const parsed = listUsersQuerySchema.safeParse(search);
    return parsed.success ? parsed.data : listUsersQuerySchema.parse({});
  },
  component: UsersPage,
});

function UsersPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { session } = Route.useRouteContext();
  const isAdmin = session?.user.role === "admin" && session.user.status === "active";
  const currentUserId = session?.user.id;

  const [createOpen, setCreateOpen] = useState(false);
  const [resetting, setResetting] = useState<UserRowData | null>(null);

  const usersQuery = useQuery({
    queryKey: ["users", search],
    queryFn: () =>
      api<UsersResponse>(
        `/api/users?${new URLSearchParams(Object.entries(search).map(([key, value]) => [key, String(value)] as [string, string]))}`,
      ),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <EmptyState
          icon={ShieldOffIcon}
          title="Admins only"
          description="User management is restricted to administrators. Ask an admin if you need access."
        />
      </div>
    );
  }

  const rows = usersQuery.data?.data ?? [];
  const meta = usersQuery.data?.meta;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8">
      <PageHeader
        eyebrow="Administration"
        title="Users"
        description="Who can sign in to the fund, and what they are allowed to do."
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <PlusIcon className="size-4" />
            Add user
          </Button>
        }
      />

      <Card>
        {usersQuery.isLoading ? (
          <div className="flex flex-col gap-2 p-5">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : rows.length > 0 ? (
          <>
            <div className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last sign-in</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      isSelf={user.id === currentUserId}
                      onResetPassword={() => setResetting(user)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-border/70 lg:hidden">
              {rows.map((user) => {
                const isSelf = user.id === currentUserId;
                return (
                  <li key={user.id} className="flex items-start gap-3 px-4 py-4">
                    <Avatar className="size-10">
                      <AvatarFallback>{initials(user.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {user.name}
                        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant={user.role === "admin" ? "default" : "secondary"} className="capitalize">
                          {user.role}
                        </Badge>
                        <StatusBadge status={user.status} />
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {user.lastSignInAt ? `Last sign-in ${formatDateTime(user.lastSignInAt)}` : "Never signed in"} · Created{" "}
                        {formatDay(user.createdAt)}
                      </p>
                    </div>
                    <UserActions user={user} isSelf={isSelf} onResetPassword={() => setResetting(user)} />
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={UserCogIcon}
              title="No users yet"
              description="Invite a teammate by creating an account and choosing their role."
              action={
                <Button onClick={() => setCreateOpen(true)} className="gap-2">
                  <PlusIcon className="size-4" />
                  Add user
                </Button>
              }
            />
          </div>
        )}

        {rows.length > 0 && (
          <Pagination
            page={search.page}
            pageSize={search.pageSize}
            total={meta?.total}
            hasNext={meta ? search.page * search.pageSize < meta.total : undefined}
            onPrevious={() => navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) })}
            onNext={() => navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })}
          />
        )}
      </Card>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </div>
  );
}

function UserRow({ user, isSelf, onResetPassword }: { user: UserRowData; isSelf: boolean; onResetPassword: () => void }) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="size-9">
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">
              {user.name}
              {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
            </p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={user.role === "admin" ? "default" : "secondary"} className="capitalize">
          {user.role}
        </Badge>
      </TableCell>
      <TableCell>
        <StatusBadge status={user.status} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{user.lastSignInAt ? formatDateTime(user.lastSignInAt) : "Never"}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDay(user.createdAt)}</TableCell>
      <TableCell className="text-right">
        <UserActions user={user} isSelf={isSelf} onResetPassword={onResetPassword} />
      </TableCell>
    </TableRow>
  );
}

function UserActions({ user, isSelf, onResetPassword }: { user: UserRowData; isSelf: boolean; onResetPassword: () => void }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
    onMutate: (vars) => {
      const deactivating = vars.path.endsWith("deactivate");
      toast.loading(deactivating ? "Deactivating…" : "Reactivating…", { id: "user-change" });
      // Flip the row's status immediately — the refetch confirms it.
      queryClient.setQueriesData<{ data: UserRowData[] }>({ queryKey: ["users"] }, (old) =>
        old ? { ...old, data: old.data.map((row) => (row.id === user.id ? { ...row, status: deactivating ? "deactivated" : "active" } : row)) } : old,
      );
    },
    onSuccess: (_result, vars) => {
      toast.success(vars.path.endsWith("deactivate") ? "User deactivated" : "User reactivated", { id: "user-change" });
      invalidate();
    },
    onError: (error: Error) => {
      invalidate(); // roll the optimistic status back
      toast.error(error.message, { id: "user-change" });
    },
  });

  const patch = useMutation({
    mutationFn: (body: unknown) => api(`/api/users/${user.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onMutate: (body) => {
      toast.loading("Updating role…", { id: "user-change" });
      const role = (body as { role?: string }).role;
      queryClient.setQueriesData<{ data: UserRowData[] }>({ queryKey: ["users"] }, (old) =>
        old ? { ...old, data: old.data.map((row) => (row.id === user.id ? { ...row, ...(role ? { role } : {}) } : row)) } : old,
      );
    },
    onSuccess: () => {
      toast.success("Role updated", { id: "user-change" });
      invalidate();
    },
    onError: (error: Error) => {
      invalidate(); // roll the optimistic role back
      toast.error(error.message, { id: "user-change" });
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${user.name}`} />}>
        <MoreHorizontalIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={isSelf} onClick={() => patch.mutate({ role: user.role === "admin" ? "editor" : "admin" })}>
          <ShieldCheckIcon />
          Make {user.role === "admin" ? "editor" : "admin"}
        </DropdownMenuItem>
        {user.status === "active" ? (
          <DropdownMenuItem disabled={isSelf} onClick={() => act.mutate({ path: `/api/users/${user.id}/deactivate` })}>
            <ShieldOffIcon />
            Deactivate
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => act.mutate({ path: `/api/users/${user.id}/reactivate` })}>
            <ShieldCheckIcon />
            Reactivate
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onResetPassword}>
          <KeyRoundIcon />
          Reset password…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: { name: "", email: "", password: "", role: "editor" as "admin" | "editor" },
    onSubmit: async ({ value }) => {
      // Close immediately — the user appears via the refetch; the API confirms behind a toast.
      onOpenChange(false);
      toast.loading(`Creating ${value.name}…`, { id: "user-change" });
      try {
        await api("/api/users", { method: "POST", body: JSON.stringify(value) });
        toast.success(`Created ${value.name}`, { id: "user-change" });
        form.reset();
        await queryClient.invalidateQueries({ queryKey: ["users"] });
      } catch (error) {
        toast.error((error as Error).message, { id: "user-change" });
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a user</DialogTitle>
          <DialogDescription>Create credentials and choose whether they can administer the fund.</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <form.Field name="name" validators={{ onChange: z.string().trim().min(1, "Name is required") }}>
            {(field) => (
              <Field label="Name" htmlFor="new-user-name" required error={firstError(field.state.meta.errors)}>
                <Input id="new-user-name" autoComplete="name" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
              </Field>
            )}
          </form.Field>

          <form.Field name="email" validators={{ onChange: z.email("A valid email is required") }}>
            {(field) => (
              <Field label="Email" htmlFor="new-user-email" required error={firstError(field.state.meta.errors)}>
                <Input
                  id="new-user-email"
                  type="email"
                  autoComplete="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="password" validators={{ onChange: z.string().min(8, "At least 8 characters") }}>
            {(field) => (
              <Field label="Temporary password" htmlFor="new-user-password" required error={firstError(field.state.meta.errors)} hint="At least 8 characters.">
                <Input
                  id="new-user-password"
                  type="password"
                  autoComplete="new-password"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="role">
            {(field) => (
              <Field label="Role" htmlFor="new-user-role" hint="Admins manage users, pricing and adjustments.">
                <NativeSelect
                  id="new-user-role"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value as "admin" | "editor")}
                >
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </NativeSelect>
              </Field>
            )}
          </form.Field>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Creating…" : "Create user"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserRowData | null; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const reset = useMutation({
    mutationFn: (newPassword: string) =>
      api(`/api/users/${user?.id}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword }) }),
    onMutate: () => {
      // Close immediately — nothing in the list changes; the API confirms behind a toast.
      onClose();
      setPassword("");
      toast.loading("Resetting password…", { id: "user-change" });
    },
    onSuccess: () => {
      toast.success("Password reset", { id: "user-change" });
    },
    onError: (error: Error) => toast.error(error.message, { id: "user-change" }),
  });

  return (
    <Dialog open={Boolean(user)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>{user ? `Set a new password for ${user.name} (${user.email}). Share it with them securely.` : ""}</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (password.length >= 8) reset.mutate(password);
          }}
        >
          <Field label="New password" htmlFor="reset-password" hint="At least 8 characters.">
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={reset.isPending || password.length < 8}>
              {reset.isPending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
