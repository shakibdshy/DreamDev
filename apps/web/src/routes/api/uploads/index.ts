import { createFileRoute } from "@tanstack/react-router";

import { ENV } from "@/env.server";
import { appContext } from "@/api/route-helpers";
import { uploadsApi } from "@/api/uploads/http";

const uploads = uploadsApi(appContext, ENV.BLOB_READ_WRITE_TOKEN);

export const Route = createFileRoute("/api/uploads/")({
  server: {
    handlers: {
      POST: uploads.postPhoto,
    },
  },
});
