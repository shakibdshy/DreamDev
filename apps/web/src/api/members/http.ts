import { appContext, ok, readBody, withApi, type ApiResolver } from "../route-helpers";

import { changeShares, createMember, getMember, listMembers, purgeMember, setStatus, softDeleteMember, updateMember } from "./service";

/** HTTP handlers for /api/members. */

export function membersApi(resolve: ApiResolver) {
  return {
    getList: withApi(async (ctx, request) => {
      const query = Object.fromEntries(new URL(request.url).searchParams);
      return listMembers(ctx, query);
    }, resolve),

    postCreate: withApi(async (ctx, request) => ok(await createMember(ctx, await readBody(request)), 201), resolve),

    getDetail: withApi(async (ctx, _request, params) => {
      const year = new URL(_request.url).searchParams.get("year");
      return getMember(ctx, params.id, year ? Number(year) : undefined);
    }, resolve),

    patchUpdate: withApi(async (ctx, request, params) => updateMember(ctx, params.id, await readBody(request)), resolve),

    postShares: withApi(async (ctx, request, params) => ok(await changeShares(ctx, params.id, await readBody(request)), 201), resolve),

    postStatus: withApi(async (ctx, request, params) => setStatus(ctx, params.id, await readBody(request)), resolve),

    deleteMember: withApi(async (ctx, request, params) => {
      const purge = new URL(request.url).searchParams.get("purge") === "true";
      return purge ? purgeMember(ctx, params.id) : softDeleteMember(ctx, params.id);
    }, resolve),
  };
}

export const members = membersApi(appContext);
