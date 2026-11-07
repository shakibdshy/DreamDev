import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";

import { formatTaka } from "@DreamDev/db/domain/money";
import { todayInDhaka } from "@DreamDev/db/domain/month";
import { Button } from "@DreamDev/ui/components/button";
import { DialogFooter } from "@DreamDev/ui/components/dialog";
import { Input } from "@DreamDev/ui/components/input";
import { NativeSelect } from "@DreamDev/ui/components/native-select";

import type { LoanView } from "@/api/loans/service";
import { BankSelect } from "@/components/bank-select";
import { DatePicker, isFutureDate } from "@/components/date-picker";
import { Field } from "@/components/field";
import { MemberSelect } from "@/components/member-select";
import { api } from "@/lib/api";
import { formatDay } from "@/lib/format";
import { queryClient } from "@/lib/query-client";

type LoanRepaymentFormProps = {
  memberId?: string;
  loanId?: string;
  onDone: () => void;
};

type RepaymentInput = {
  memberId: string;
  loanId: string;
  amount: number;
  bankAccountId: string;
  creditDate: string;
};

export function LoanRepaymentForm(props: LoanRepaymentFormProps) {
  return <RepaymentForm key={JSON.stringify([props.memberId, props.loanId])} {...props} />;
}

function validCreditDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function RepaymentForm({ memberId, loanId, onDone }: LoanRepaymentFormProps) {
  const id = useId();
  const [chosenMemberId, setMember] = useState("");
  const [chosenLoanId, setLoan] = useState("");
  // Associate the draft with its loan so a refetch cannot move an amount to another loan.
  const [payment, setPayment] = useState({ loanId: "", amount: "" });
  const [amountTouched, setAmountTouched] = useState(false);
  const [bankAccountId, setBank] = useState("");
  const [creditDate, setDate] = useState(todayInDhaka);
  const selectedMemberId = memberId ?? chosenMemberId;

  const loansQuery = useQuery({
    queryKey: ["loans", selectedMemberId],
    queryFn: ({ signal }) =>
      api<{ loans: LoanView[]; totalOutstanding: number }>(`/api/members/${selectedMemberId}/loans`, { signal }),
    enabled: selectedMemberId !== "",
  });
  const outstandingLoans = (loansQuery.data?.loans ?? []).filter(
    (loan) => !loan.settled && loan.outstanding > 0 && (loanId === undefined || loan.id === loanId),
  );
  const selectedLoan = outstandingLoans.find((loan) => loan.id === chosenLoanId)
    ?? (outstandingLoans.length === 1 ? outstandingLoans[0] : undefined);
  const amount = selectedLoan && payment.loanId === selectedLoan.id ? payment.amount : "";
  const amountValue = Number(amount);
  const amountError = !amount
    ? "Enter a repayment amount."
    : !/^\d+$/.test(amount) || !Number.isSafeInteger(amountValue) || amountValue < 1
      ? "Enter whole taka, at least ৳1."
      : selectedLoan && amountValue > selectedLoan.outstanding
        ? `Cannot exceed the remaining balance of ${formatTaka(selectedLoan.outstanding)}.`
        : undefined;
  const showAmountError = amountTouched && Boolean(amountError);
  const dateError = !validCreditDate(creditDate)
    ? "Choose a valid credit date."
    : isFutureDate(creditDate)
      ? "Credit date can't be in the future."
      : undefined;

  const repay = useMutation({
    mutationFn: ({ loanId: repaymentLoanId, amount, bankAccountId, creditDate }: RepaymentInput) =>
      api<{ settled: boolean; outstandingAfter: number }>(`/api/loans/${repaymentLoanId}`, {
        method: "POST",
        body: JSON.stringify({ amount, bankAccountId, creditDate }),
      }),
    onSuccess: async (result, values) => {
      toast.success(result.settled ? "Repayment recorded — loan cleared" : `Repayment recorded — ${formatTaka(result.outstandingAfter)} remaining`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["loans", values.memberId] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["banks"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["member", values.memberId] }),
        queryClient.invalidateQueries({ queryKey: ["members"] }),
        queryClient.invalidateQueries({ queryKey: ["position", values.memberId] }),
      ]);
      onDone();
    },
    onError: (error: Error) => toast.error(`Could not record repayment: ${error.message}`),
  });
  const canSubmit = Boolean(
    selectedMemberId && selectedLoan && loansQuery.isSuccess && !loansQuery.isPlaceholderData
    && !amountError && bankAccountId.trim() && !dateError && !repay.isPending,
  );
  const remainingAfter = selectedLoan && !amountError ? selectedLoan.outstanding - amountValue : undefined;

  const resetLoanDraft = () => {
    setPayment({ loanId: "", amount: "" });
    setAmountTouched(false);
    repay.reset();
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit || !selectedLoan) return;
        repay.mutate({ memberId: selectedMemberId, loanId: selectedLoan.id, amount: amountValue, bankAccountId, creditDate });
      }}
    >
      <fieldset disabled={repay.isPending} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2">
          A repayment reduces the selected loan balance. It is not a savings contribution.
        </p>

        {memberId === undefined && (
          <Field label="Member" htmlFor={`${id}-member`} required className="sm:col-span-2">
            <MemberSelect
              id={`${id}-member`}
              value={selectedMemberId}
              onChange={(value) => {
                setMember(value);
                setLoan("");
                resetLoanDraft();
              }}
            />
          </Field>
        )}

        {!selectedMemberId ? (
          <p role="status" className="text-sm text-muted-foreground sm:col-span-2">Select a member to view outstanding loans.</p>
        ) : loansQuery.isPending || loansQuery.isPlaceholderData ? (
          <p role="status" className="text-sm text-muted-foreground sm:col-span-2">Loading loans…</p>
        ) : loansQuery.isError ? (
          <div className="flex flex-col items-start gap-2 sm:col-span-2">
            <p role="alert" className="text-sm text-destructive">Could not load loans: {loansQuery.error.message}</p>
            <Button type="button" variant="outline" disabled={loansQuery.isFetching} onClick={() => void loansQuery.refetch()}>
              {loansQuery.isFetching ? "Retrying…" : "Retry loading loans"}
            </Button>
          </div>
        ) : outstandingLoans.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground sm:col-span-2">
            {loanId !== undefined ? "This loan has no outstanding balance or is no longer available." : "This member has no outstanding loans to repay."}
          </p>
        ) : (
          <>
            <Field label="Loan" htmlFor={`${id}-loan`} required className="sm:col-span-2">
              <NativeSelect
                id={`${id}-loan`}
                value={selectedLoan?.id ?? ""}
                required
                disabled={loanId !== undefined}
                onChange={(event) => {
                  setLoan(event.target.value);
                  resetLoanDraft();
                }}
              >
                <option value="">Select an outstanding loan</option>
                {outstandingLoans.map((loan) => (
                  <option key={loan.id} value={loan.id}>
                    {formatTaka(loan.amount)} principal · {formatDay(loan.date)} · {formatTaka(loan.outstanding)} outstanding
                    {outstandingLoans.length > 1 ? ` · #${loan.id.slice(-6)}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            {selectedLoan && (
              <>
                <dl className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/25 p-3 sm:col-span-2 sm:grid-cols-3">
                  {[
                    { label: "Original principal", value: selectedLoan.amount },
                    { label: "Already repaid", value: selectedLoan.repaid },
                    { label: "Remaining", value: selectedLoan.outstanding },
                  ].map((item) => (
                    <div key={item.label}>
                      <dt className="text-xs text-muted-foreground">{item.label}</dt>
                      <dd className="text-sm font-medium tabular">{formatTaka(item.value)}</dd>
                    </div>
                  ))}
                </dl>

                <Field label="Repayment amount (৳)" htmlFor={`${id}-amount`} required>
                  <Input
                    id={`${id}-amount`}
                    inputMode="numeric"
                    required
                    value={amount}
                    placeholder="Enter whole taka"
                    aria-invalid={showAmountError}
                    aria-describedby={`${id}-amount-hint${showAmountError ? ` ${id}-amount-error` : ""}`}
                    onBlur={() => setAmountTouched(true)}
                    onChange={(event) => {
                      setPayment({ loanId: selectedLoan.id, amount: event.target.value });
                      setAmountTouched(true);
                    }}
                  />
                  <p id={`${id}-amount-hint`} className="text-xs text-muted-foreground">From ৳1 to {formatTaka(selectedLoan.outstanding)}, whole taka only.</p>
                  {showAmountError && <p id={`${id}-amount-error`} role="alert" className="text-xs text-destructive">{amountError}</p>}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => {
                      setPayment({ loanId: selectedLoan.id, amount: String(selectedLoan.outstanding) });
                      setAmountTouched(true);
                    }}
                  >
                    Repay full balance
                  </Button>
                </Field>

                <Field label="Receiving bank account" htmlFor={`${id}-bank`} required>
                  <BankSelect id={`${id}-bank`} value={bankAccountId} onChange={setBank} />
                </Field>
                <Field label="Credit date" htmlFor={`${id}-date`} required>
                  <DatePicker
                    id={`${id}-date`}
                    required
                    max={todayInDhaka()}
                    value={creditDate}
                    aria-invalid={Boolean(dateError)}
                    aria-describedby={dateError ? `${id}-date-error` : undefined}
                    onChange={setDate}
                  />
                  {dateError && <p id={`${id}-date-error`} role="alert" className="text-xs text-destructive">{dateError}</p>}
                </Field>
                <div role="status" className="flex flex-col justify-center gap-1 text-sm sm:col-span-2">
                  {remainingAfter !== undefined ? (
                    <>
                      <p>Remaining after repayment: <span className="font-medium tabular">{formatTaka(remainingAfter)}</span></p>
                      {remainingAfter === 0 && <p className="text-success">This repayment will clear the loan.</p>}
                    </>
                  ) : <p className="text-xs text-muted-foreground">Enter a valid amount to preview the remaining balance.</p>}
                </div>
              </>
            )}
          </>
        )}

        {repay.isError && <p role="alert" className="text-sm text-destructive sm:col-span-2">Could not record repayment: {repay.error.message}</p>}
        <DialogFooter className="sm:col-span-2">
          <Button type="submit" disabled={!canSubmit}>
            {repay.isPending ? "Recording…" : "Record repayment"}
          </Button>
        </DialogFooter>
      </fieldset>
    </form>
  );
}
