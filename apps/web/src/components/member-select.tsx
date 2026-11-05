import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

interface MembersResponse {
  data: { id: string; name: string; mobile: string; status: string }[];
}

/** Reusable Member picker for money forms. */
export function MemberSelect({
  value,
  onChange,
  id = "member",
}: {
  value: string;
  onChange: (memberId: string) => void;
  id?: string;
}) {
  const membersQuery = useQuery({
    queryKey: ["members", "select"],
    queryFn: () => api<MembersResponse>("/api/members?pageSize=100&sort=name&order=asc"),
  });

  return (
    <select
      id={id}
      className="h-9 rounded-md border bg-transparent px-3"
      value={value}
      disabled={membersQuery.isLoading}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{membersQuery.isLoading ? "Loading members…" : "Select a Member"}</option>
      {membersQuery.data?.data.map((member) => (
        <option key={member.id} value={member.id}>
          {member.name} ({member.mobile}){member.status !== "active" ? ` — ${member.status}` : ""}
        </option>
      ))}
    </select>
  );
}
