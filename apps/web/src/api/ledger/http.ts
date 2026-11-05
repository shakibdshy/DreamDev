import { appContext, ok, readBody, withApi, type ApiResolver } from "../route-helpers";

import { createAdjustment, softDeleteAdjustment, updateAdjustment } from "./adjustment";
import { createExpense, softDeleteExpense, updateExpense } from "./expense";
import { createTransfer, softDeleteTransfer, updateTransfer } from "./transfer";

/** HTTP handlers for Expenses, Transfers and Adjustments. */

export function ledgerApi(resolve: ApiResolver) {
  return {
    // Expenses
    postExpense: withApi(async (ctx, request) => ok(await createExpense(ctx, await readBody(request)), 201), resolve),
    patchExpense: withApi(async (ctx, request, params) => updateExpense(ctx, params.id, await readBody(request)), resolve),
    deleteExpense: withApi(async (ctx, _request, params) => softDeleteExpense(ctx, params.id), resolve),

    // Transfers
    postTransfer: withApi(async (ctx, request) => ok(await createTransfer(ctx, await readBody(request)), 201), resolve),
    patchTransfer: withApi(async (ctx, request, params) => updateTransfer(ctx, params.id, await readBody(request)), resolve),
    deleteTransfer: withApi(async (ctx, _request, params) => softDeleteTransfer(ctx, params.id), resolve),

    // Adjustments (Admin-only in the service layer)
    postAdjustment: withApi(async (ctx, request) => ok(await createAdjustment(ctx, await readBody(request)), 201), resolve),
    patchAdjustment: withApi(async (ctx, request, params) => updateAdjustment(ctx, params.id, await readBody(request)), resolve),
    deleteAdjustment: withApi(async (ctx, _request, params) => softDeleteAdjustment(ctx, params.id), resolve),
  };
}

export const ledger = ledgerApi(appContext);
