import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { debounce } from "@tanstack/pacer";
import { toast } from "sonner";
import { useMemo } from "react";
import { z } from "zod";

import { formatTaka } from "@DreamDev/db/domain/money";
import { Button } from "@DreamDev/ui/components/button";
import { Input } from "@DreamDev/ui/components/input";
import { Label } from "@DreamDev/ui/components/label";

import { listMembersQuerySchema } from "@/api/members/schema";
import { api } from "@/lib/api";
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

export const Route = createFileRoute("/_auth/members")({
  validateSearch: (search: Record<string, unknown>) => {
    const parsed = listMembersQuerySchema.safeParse(search);
    return parsed.success ? parsed.data : listMembersQuerySchema.parse({});
  },
  component: MembersPage,
});

function MembersPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  // Pacer: debounce keystrokes so search doesn't hammer the API
  const onSearch = useMemo(
    () =>
      debounce(
        (value: string) => navigate({ search: (prev) => ({ ...prev, search: value || undefined, page: 1 }) }),
        { wait: 300 },
      ),
    [navigate],
  );

  const membersQuery = useQuery({
    queryKey: ["members", search],
    queryFn: () =>
      api<MembersResponse>(
        `/api/members?${new URLSearchParams(Object.entries(search).map(([k, v]) => [k, String(v)]) as [string, string][])}`,
      ),
  });

  const columnHelper = createColumnHelper<MemberRow>();
  const columns = [
    columnHelper.display({
      id: "photo",
      header: "",
      cell: ({ row }) =>
        row.original.photo ? (
          <img src={row.original.photo} alt="" loading="lazy" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <div className="h-8 w-8 rounded-full bg-muted" />
        ),
    }),
    columnHelper.accessor("name", {
      header: "Name",
      cell: (info) => <Link to="/members/$id" params={{ id: info.row.original.id }} search={{}} className="font-medium underline-offset-2 hover:underline">{info.getValue()}</Link>,
    }),
    columnHelper.accessor("mobile", { header: "Mobile" }),
    columnHelper.accessor("joiningDate", { header: "Joined", cell: (info) => new Date(info.getValue()).toLocaleDateString() }),
    columnHelper.accessor("shares", { header: "Shares" }),
    columnHelper.accessor("status", { header: "Status" }),
    columnHelper.accessor((row) => row.advance > 0 ? -row.advance : row.due, {
      id: "position",
      header: "Due / Advance",
      cell: (info) => {
        const { due, advance } = info.row.original;
        if (advance > 0) return <span className="text-emerald-600">Advance {formatTaka(advance)}</span>;
        return <span className={due > 0 ? "font-semibold text-destructive" : ""}>{formatTaka(due)}</span>;
      },
    }),
  ];

  const table = useReactTable({
    data: membersQuery.data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Members</h1>

      <CreateMemberForm />

      <Input
        placeholder="Search name or mobile…"
        defaultValue={search.search ?? ""}
        onChange={(e) => onSearch(e.target.value)}
        className="max-w-xs"
      />

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th key={header.id} className="px-3 py-2 text-left font-medium">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {membersQuery.isLoading ? (
              <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <tr key={row.original.id} className="border-t">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-muted-foreground">No members yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{membersQuery.data ? `${membersQuery.data.meta.total} member(s)` : ""}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={search.page <= 1}
            onClick={() => navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) })}>Previous</Button>
          <span className="text-sm text-muted-foreground">{search.page}</span>
          <Button variant="outline" size="sm" disabled={!membersQuery.data || search.page * search.pageSize >= membersQuery.data.meta.total}
            onClick={() => navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })}>Next</Button>
        </div>
      </div>
    </div>
  );
}

function CreateMemberForm() {
  const queryClient = useQueryClient();
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const form = useForm({
    defaultValues: { name: "", mobile: "", joiningDate: "", shareQuantity: "1", address: "" },
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
        await queryClient.invalidateQueries({ queryKey: ["members"] });
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
  });

  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer font-medium">New Member</summary>
      <form className="mt-3 grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}>
        <form.Field name="name" validators={{ onChange: z.string().trim().min(1, "Name is required") }}>
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="m-name">Name</Label>
              <Input id="m-name" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="mobile" validators={{ onChange: z.string().regex(/^01[3-9]\d{8}$/, "01XXXXXXXXX") }}>
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="m-mobile">Mobile</Label>
              <Input id="m-mobile" inputMode="numeric" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="joiningDate" validators={{ onChange: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD") }}>
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="m-joined">Joining date</Label>
              <Input id="m-joined" type="date" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="shareQuantity" validators={{ onChange: z.string().regex(/^[1-9]\d{0,2}$/, "1–100 shares") }}>
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="m-shares">No. of shares</Label>
              <Input id="m-shares" inputMode="numeric" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="address">
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="m-address">Address (optional)</Label>
              <Input id="m-address" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
            </div>
          )}
        </form.Field>
        <div className="flex flex-col gap-1">
          <Label htmlFor="m-photo">Photo (optional)</Label>
          <Input id="m-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
          <p className="text-xs text-muted-foreground">Resized to 512px automatically.</p>
        </div>
        <div className="sm:col-span-3">
          <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit || isSubmitting}>{isSubmitting ? "Adding…" : "Add Member"}</Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </details>
  );
}

function FieldError({ errors }: { errors: unknown[] }) {
  const message = errors[0] && typeof errors[0] === "object" && "message" in errors[0] ? String((errors[0] as { message: string }).message) : undefined;
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}
