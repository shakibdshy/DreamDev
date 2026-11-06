import { appContext, ok, readBody, withApi, type ApiResolver } from "../route-helpers";

import { createUser, deactivateUser, listUsers, reactivateUser, resetPassword, updateUser } from "./service";

/** HTTP handlers for /api/users — thin wiring over the service, testable with an injected resolver. */

export function usersApi(resolve: ApiResolver) {
  return {
    getList: withApi(async (ctx, request) => {
      const query = Object.fromEntries(new URL(request.url).searchParams);
      return listUsers(ctx, query);
    }, resolve),

    postCreate: withApi(async (ctx, request) => {
      const user = await createUser(ctx, await readBody(request));
      return ok(user, 201);
    }, resolve),

    patchUpdate: withApi(async (ctx, request, params) => updateUser(ctx, params.id, await readBody(request)), resolve),

    postDeactivate: withApi(async (ctx, _request, params) => deactivateUser(ctx, params.id), resolve),

    postReactivate: withApi(async (ctx, _request, params) => reactivateUser(ctx, params.id), resolve),

    postResetPassword: withApi(async (ctx, request, params) => resetPassword(ctx, params.id, await readBody(request)), resolve),
  };
}

export const users = usersApi(appContext);
