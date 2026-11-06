import { appContext, ok, readBody, withApi, type ApiResolver } from "../route-helpers";

import { createLoan, createRepayment, memberLoans, softDeleteLoan } from "./service";

/** HTTP handlers for Loans. */

export function loansApi(resolve: ApiResolver) {
  return {
    getList: withApi(async (ctx, _request, params) => memberLoans(ctx, params.id), resolve),

    postCreate: withApi(async (ctx, request, params) => {
      const input = (await readBody(request)) as Record<string, unknown>;
      return ok(await createLoan(ctx, { ...input, memberId: params.id }), 201);
    }, resolve),

    postRepayment: withApi(async (ctx, request, params) =>
      ok(await createRepayment(ctx, params.id, await readBody(request)), 201), resolve),

    deleteLoan: withApi(async (ctx, _request, params) => softDeleteLoan(ctx, params.id), resolve),
  };
}

export const loans = loansApi(appContext);
