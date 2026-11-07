import { NativeSelect } from "@DreamDev/ui/components/native-select";
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
    <NativeSelect id={id} value={value} disabled={membersQuery.isLoading} onChange={(event) => onChange(event.target.value)}>
      <option value="">{membersQuery.isLoading ? "Loading members…" : "Select a Member"}</option>
      {membersQuery.data?.data.map((member) => (
        <option key={member.id} value={member.id}>
          {member.name} ({member.mobile}){member.status !== "active" ? ` — ${member.status}` : ""}
        </option>
      ))}
    </NativeSelect>
  );
}

/** The member's display name from the shared picker cache — for optimistic rows. */
export function cachedMemberName(queryClient: import("@tanstack/react-query").QueryClient, memberId: string): string | undefined {
  const members = queryClient.getQueryData<MembersResponse>(["members", "select"]);
  return members?.data.find((m) => m.id === memberId)?.name;
}
