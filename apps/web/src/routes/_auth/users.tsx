import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@DreamDev/ui/components/button";
import { Input } from "@DreamDev/ui/components/input";
import { Label } from "@DreamDev/ui/components/label";

import { api } from "@/lib/api";
import { listUsersQuerySchema } from "@/api/users/schema";

import type { UserListItem } from "@/api/users/service";

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

  const usersQuery = useQuery({
    queryKey: ["users", search],
    queryFn: () =>
      api<UsersResponse>(
        `/api/users?${new URLSearchParams(
          Object.entries(search).map(([key, value]) => [key, String(value)] as [string, string]),
        )}`,
      ),
    enabled: isAdmin,
  });

  const columnHelper = createColumnHelper<UserRowData>();
  const columns = [
    columnHelper.accessor("name", { header: "Name" }),
    columnHelper.accessor("email", { header: "Email" }),
    columnHelper.accessor("role", { header: "Role" }),
    columnHelper.accessor("status", { header: "Status" }),
    columnHelper.accessor("lastSignInAt", {
      header: "Last sign-in",
      cell: (info) => {
        const value = info.getValue();
        return value ? new Date(value).toLocaleString() : "—";
      },
    }),
    columnHelper.accessor("createdAt", {
      header: "Created",
      cell: (info) => new Date(info.getValue()).toLocaleDateString(),
    }),
  ];

  const table = useReactTable({
    data: usersQuery.data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: Math.ceil((usersQuery.data?.meta.total ?? 0) / search.pageSize),
  });

  if (!isAdmin) {
    return <p className="p-4 text-muted-foreground">Only Admins can manage Users.</p>;
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Users</h1>

      <CreateUserForm />

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-3 py-2 text-left font-medium">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            ))}
          </thead>
          <tbody>
            {usersQuery.isLoading ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <UserRow key={row.original.id} user={row.original}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </UserRow>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {usersQuery.data ? `${usersQuery.data.meta.total} user${usersQuery.data.meta.total === 1 ? "" : "s"}` : ""}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={search.page <= 1}
            onClick={() => navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) })}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">{search.page}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!usersQuery.data || search.page * search.pageSize >= usersQuery.data.meta.total}
            onClick={() => navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function UserRow({ user, children }: { user: UserRowData; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("Done");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const patch = useMutation({
    mutationFn: (body: unknown) => api(`/api/users/${user.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const onResetPassword = () => {
    const newPassword = window.prompt(`New password for ${user.name} (min 8 characters)`);
    if (!newPassword) return;
    act.mutate({ path: `/api/users/${user.id}/reset-password`, body: { newPassword } });
  };

  return (
    <tr className="border-t">
      {children}
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => patch.mutate({ role: user.role === "admin" ? "editor" : "admin" })}
        >
          Make {user.role === "admin" ? "Editor" : "Admin"}
        </Button>
        {user.status === "active" ? (
          <Button variant="ghost" size="sm" onClick={() => act.mutate({ path: `/api/users/${user.id}/deactivate` })}>
            Deactivate
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => act.mutate({ path: `/api/users/${user.id}/reactivate` })}>
            Reactivate
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onResetPassword}>
          Reset password…
        </Button>
      </td>
    </tr>
  );
}

function CreateUserForm() {
  const queryClient = useQueryClient();

  const form = useForm({
    defaultValues: { name: "", email: "", password: "", role: "editor" as "admin" | "editor" },
    onSubmit: async ({ value }) => {
      try {
        await api("/api/users", { method: "POST", body: JSON.stringify(value) });
        toast.success(`Created ${value.name}`);
        form.reset();
        await queryClient.invalidateQueries({ queryKey: ["users"] });
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
  });

  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer font-medium">New User</summary>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.Field
          name="name"
          validators={{ onChange: z.string().trim().min(1, "Name is required") }}
        >
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-user-name">Name</Label>
              <Input id="new-user-name" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <form.Field name="email" validators={{ onChange: z.email("A valid email is required") }}>
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-user-email">Email</Label>
              <Input id="new-user-email" type="email" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <form.Field name="password" validators={{ onChange: z.string().min(8, "At least 8 characters") }}>
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-user-password">Password</Label>
              <Input id="new-user-password" type="password" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <form.Field name="role">
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-user-role">Role</Label>
              <select
                id="new-user-role"
                className="h-9 rounded-md border bg-transparent px-3"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value as "admin" | "editor")}
              >
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <div className="sm:col-span-2">
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? "Creating…" : "Create User"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </details>
  );
}

function FieldError({ errors }: { errors: unknown[] }) {
  const message = errors[0] && typeof errors[0] === "object" && "message" in errors[0]
    ? String((errors[0] as { message: string }).message)
    : undefined;
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}
