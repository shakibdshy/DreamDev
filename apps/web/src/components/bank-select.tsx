import { NativeSelect } from "@DreamDev/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";

import { formatTaka } from "@DreamDev/db/domain/money";

import type { BankAccountItem } from "@/api/banks/service";
import { api } from "@/lib/api";

interface BanksResponse {
  data: (Omit<BankAccountItem, "createdAt"> & { createdAt: string })[];
}

/** Reusable Bank Account picker for money forms — shows each account's Current Balance. */
export function BankSelect({
  value,
  onChange,
  id = "bank-account",
  disabled,
}: {
  value: string;
  onChange: (bankAccountId: string) => void;
  id?: string;
  disabled?: boolean;
}) {
  const banksQuery = useQuery({
    queryKey: ["banks"],
    queryFn: () => api<BanksResponse>("/api/banks"),
  });

  return (
    <NativeSelect
      id={id}
      value={value}
      disabled={disabled || banksQuery.isLoading}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{banksQuery.isLoading ? "Loading accounts…" : "Select a Bank Account"}</option>
      {banksQuery.data?.data.map((bank) => (
        <option key={bank.id} value={bank.id}>
          {bank.bankName} — {formatTaka(bank.currentBalance)}
        </option>
      ))}
    </NativeSelect>
  );
}
