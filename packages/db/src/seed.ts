import { addMonths, monthOfDate } from "./domain/month";
import { createPrismaClient, type Database } from "./index";
import { ENV } from "./env";

/**
 * Demo seed (ticket #11): clearly-fake-but-realistic team data — members with
 * varied shares and statuses, two bank accounts, ~8 months of mixed entries.
 * Refuses to run against a non-empty database.
 */

const DAY = (month: string, day: number) => new Date(`${month}-${String(day).padStart(2, "0")}T00:00:00Z`);

export async function seedIfEmpty(db: Database): Promise<{ seeded: boolean; summary: string }> {
  const [members, banks] = await Promise.all([db.member.count(), db.bankAccount.count()]);
  if (members > 0 || banks > 0) {
    throw new Error(`Refusing to seed: database already has data (${members} members, ${banks} bank accounts)`);
  }

  const thisMonth = monthOfDate(new Date());
  const months = Array.from({ length: 8 }, (_, i) => addMonths(thisMonth, -(7 - i)));
  const joinMonth = months[0]!;

  await db.sharePriceEntry.create({ data: { effectiveMonth: "1970-01", price: 5000 } });

  const dbbl = await db.bankAccount.create({ data: { bankName: "Demo Dutch-Bangla Bank", address: "Demo Road 1, Dhaka", openingBalance: 50000 } });
  const brac = await db.bankAccount.create({ data: { bankName: "Demo BRAC Bank", address: "Demo Avenue 2, Chattogram", openingBalance: 20000 } });

  //  Members: (name, mobile, shares, behavior) — one inactive, one exited, one overpayer
  const roster = [
    { name: "Demo Rahim", mobile: "01710000001", shares: 3, pay: "full" },
    { name: "Demo Karim", mobile: "01710000002", shares: 2, pay: "partial" },
    { name: "Demo Salma", mobile: "01710000003", shares: 1, pay: "overpay" },
    { name: "Demo Jahid", mobile: "01710000004", shares: 2, pay: "inactive" },
    { name: "Demo Nayeem", mobile: "01710000005", shares: 1, pay: "exited" },
  ] as const;

  const memberIds: Record<string, string> = {};
  for (const person of roster) {
    const member = await db.member.create({
      data: { name: person.name, mobile: person.mobile, joiningDate: DAY(joinMonth, 1), createdBy: "seed" },
    });
    memberIds[person.name] = member.id;
  }
  await db.shareAllotment.createMany({
    data: roster.map((person) => ({
      memberId: memberIds[person.name]!,
      quantity: person.shares,
      effectiveMonth: joinMonth,
      createdBy: "seed",
    })),
  });

  // Status lifecycle: Jahid inactive for the last 2 months; Nayeem exited 3 months ago
  await db.memberStatusChange.create({ data: { memberId: memberIds["Demo Jahid"]!, status: "inactive", date: DAY(months[6]!, 1), createdBy: "seed" } });
  await db.member.update({ where: { id: memberIds["Demo Jahid"] }, data: { status: "inactive" } });
  await db.memberStatusChange.create({ data: { memberId: memberIds["Demo Nayeem"]!, status: "exited", date: DAY(months[5]!, 15), createdBy: "seed" } });
  await db.member.update({ where: { id: memberIds["Demo Nayeem"] }, data: { status: "exited", exitDate: DAY(months[5]!, 15) } });

  const contributionRows: { memberId: string; bankAccountId: string; amount: number; creditDate: Date; sharePriceAtEntry: number; shareQtyAtEntry: number; createdBy: string }[] = [];
  for (const [index, month] of months.entries()) {
    for (const person of roster) {
      const memberId = memberIds[person.name]!;
      const active = person.pay !== "inactive" || index < 6;
      const notExited = person.pay !== "exited" || index <= 5;
      if (!active || !notExited) continue;

      const bill = person.shares * 5000;
      const amount =
        person.pay === "full" ? bill : person.pay === "partial" ? (index % 3 === 0 ? Math.round(bill * 0.6) : bill) : index === months.length - 1 ? bill + 1000 : bill;

      contributionRows.push({
        memberId,
        bankAccountId: dbbl.id,
        amount,
        creditDate: DAY(month, 10),
        sharePriceAtEntry: 5000,
        shareQtyAtEntry: person.shares,
        createdBy: "seed",
      });
    }
  }
  await db.contribution.createMany({ data: contributionRows });
  const contributions = contributionRows.length;

  // A loan, partially repaid (Karim); an expense; a transfer between accounts; a waiver adjustment
  const loan = await db.loan.create({
    data: { memberId: memberIds["Demo Karim"]!, bankAccountId: dbbl.id, amount: 20000, date: DAY(months[5]!, 5), note: "demo emergency", createdBy: "seed" },
  });
  await db.loanRepayment.create({
    data: { loanId: loan.id, memberId: memberIds["Demo Karim"]!, bankAccountId: dbbl.id, amount: 8000, creditDate: DAY(months[7]!, 8), createdBy: "seed" },
  });
  await db.expense.create({ data: { bankAccountId: dbbl.id, amount: 750, date: DAY(months[6]!, 20), note: "demo bank charge", createdBy: "seed" } });
  await db.transfer.create({ data: { fromAccountId: dbbl.id, toAccountId: brac.id, amount: 25000, date: DAY(months[7]!, 2), createdBy: "seed" } });
  await db.adjustment.create({
    data: { memberId: memberIds["Demo Salma"]!, amount: -5000, month: months[0]!, reason: "demo waiver: first month on us", createdBy: "seed" },
  });

  return {
    seeded: true,
    summary: `Seeded ${roster.length} members, 2 bank accounts, ${contributions} contributions, 1 loan (৳12,000 outstanding), 1 repayment, 1 expense, 1 transfer, 1 adjustment`,
  };
}

// CLI entry: bun run src/seed.ts (from packages/db)
if (import.meta.main) {
  const db = createPrismaClient({ DATABASE_URL: ENV.DATABASE_URL });
  try {
    const result = await seedIfEmpty(db);
    console.log(`✅ ${result.summary}`);
  } catch (error) {
    console.error(`❌ ${(error as Error).message}`);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}
