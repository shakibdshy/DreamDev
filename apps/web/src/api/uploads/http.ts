import { type ApiResolver, withApi } from "../route-helpers";

import { uploadPhoto } from "./service";

/** The Blob token comes from env at call time so tests can inject their own deps. */
export function uploadsApi(resolve: ApiResolver, blobToken: string | undefined) {
  return {
    postPhoto: withApi(async (ctx, request) => {
      const deps = { ...ctx, blobToken };
      const result = await uploadPhoto(deps, request);
      return Response.json(result, { status: 201 });
    }, resolve),
  };
}
