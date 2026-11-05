import * as Axiom from "@alchemy.run/axiom";
import * as Alchemy from "alchemy";
import * as Command from "alchemy/Command";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import "varlock/auto-load";

export const observability = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const datasetName = `DreamDev-${stage}-logs`;

  const dataset = yield* Axiom.Dataset("logs", {
    name: datasetName,
    kind: "axiom:events:v1",
    description: "DreamDev application logs",
  });
  const ingest = yield* Axiom.ApiToken("logs-ingest", {
    name: `DreamDev-${stage}-logs-ingest`,
    datasetCapabilities: {
      [datasetName]: {
        ingest: ["create"],
      },
    },
  });

  return {
    dataset,
    runtimeEnv: {
      AXIOM_API_KEY: ingest.token,
      AXIOM_DATASET: dataset.name,
      AXIOM_EDGE_URL: dataset.edgeDeploymentUrl,
    },
  };
});

export default Alchemy.Stack(
  "DreamDev",
  {
    providers: Layer.mergeAll(Axiom.providers(), Command.providers()),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const observabilityResources = yield* observability;
    const webDev = yield* Command.Dev("web-dev", {
      command: "bun run dev:bare",
      cwd: "../../apps/web",
      env: observabilityResources.runtimeEnv,
    });
    const isDev = yield* Alchemy.ALCHEMY_DEV;
    const { stage } = yield* Alchemy.Stack;
    if (!isDev && (stage === "preview" || stage === "production")) {
      yield* Command.Exec("axiom-vercel-env", {
        command: `bun run env:${stage}`,
        cwd: "../..",
        env: observabilityResources.runtimeEnv,
        memo: { include: ["scripts/sync-vercel-env.ts", "vercel.json"] },
      });
    }

    return {
      web: webDev.url,
      axiomDataset: observabilityResources.dataset.name,
    };
  }),
);
