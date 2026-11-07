import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";

/**
 * Client-side definitions for the generic gated surface (ticket 5/8) — types
 * for the chat panel's confirm cards. No server imports here; the bound
 * executors and the role-scoped schemas live in write-tools.ts, and the
 * server re-validates everything on resume.
 */

export const previewWriteDef = toolDefinition({
  name: "preview_write",
  description: "Preview a record change before proposing it.",
  inputSchema: z.object({
    entity: z.enum(["loan", "loan_repayment", "expense", "transfer", "adjustment", "member", "bank", "contribution"]),
    action: z.enum(["create", "update", "status", "shares", "repay"]),
    id: z.string().optional(),
    args: z.record(z.string(), z.unknown()),
  }),
  outputSchema: z.object({ lines: z.array(z.string()) }),
});

export const writeRecordDef = toolDefinition({
  name: "write_record",
  description: "Record a change — pauses for user approval.",
  inputSchema: previewWriteDef.inputSchema,
  outputSchema: z.object({ recorded: z.boolean() }),
  needsApproval: true,
});

export const previewDeleteDef = toolDefinition({
  name: "preview_delete",
  description: "Preview a soft delete before proposing it.",
  inputSchema: z.object({
    entity: z.enum(["contribution", "loan", "loan_repayment", "expense", "transfer", "adjustment", "member", "bank"]),
    id: z.string().min(1),
  }),
  outputSchema: z.object({ lines: z.array(z.string()) }),
});

export const deleteRecordDef = toolDefinition({
  name: "delete_record",
  description: "Soft-delete a record — pauses for user approval.",
  inputSchema: previewDeleteDef.inputSchema,
  outputSchema: z.object({ deleted: z.boolean() }),
  needsApproval: true,
});
