/**
 * Fly target. Fly Machines run a pre-built image, so this stack builds the
 * runtime image with Docker and pushes it to Fly's registry, then runs it as
 * a Machine in a Fly App.
 *
 * Requires Docker and `FLY_API_TOKEN` (the same token Alchemy uses for the
 * Fly provider). Runtime configuration is not baked in: set it with
 * `fly secrets set` on the App.
 */
import * as Docker from "@alchemy.run/docker";
import * as Fly from "@alchemy.run/fly";
import * as Alchemy from "alchemy";
import type { PropsInput } from "alchemy/Input";
import * as Output from "alchemy/Output";
import { Stack } from "alchemy/Stack";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { stageSlug } from "../shared/stage.ts";

export default Alchemy.Stack(
  "EdgeSpecFly",
  {
    // Fly has no remote state store; state stays on the deploying machine.
    state: Alchemy.localState(),
    providers: Layer.merge(Fly.providers(), Docker.providers()),
  },
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    const isProd = stage === "prod";
    const slug = stageSlug(stage);
    // Fly App names are globally unique, DNS-safe and at most 30 characters.
    const name = (isProd ? "edge-spec" : `edge-spec-${slug}`).slice(0, 30);

    const app = yield* Fly.App("EdgeSpecApp", { name });

    const image = yield* Docker.Image("EdgeSpecImage", {
      // Depend on the App so its registry namespace exists before the push.
      name: app.appName,
      tag: process.env.EDGESPEC_IMAGE_TAG ?? "latest",
      build: { context: "../..", dockerfile: "Dockerfile", platform: "linux/amd64" },
      registry: {
        // Fly's registry: any username, the API token as password.
        server: "registry.fly.io",
        username: "x",
        password: yield* Config.Redacted("FLY_API_TOKEN"),
      },
    });

    const pushedImage = Output.asOutput(image.imageRef);
    const imageRef = Output.flatMap((digest: string | undefined) =>
      digest ? Output.asOutput(digest) : pushedImage,
    )(image.repoDigest);

    const machineProps: PropsInput<Fly.MachineProps> = {
      app,
      // A digest, not a tag, so a changed image rolls the Machine.
      image: imageRef,
      region: process.env.FLY_REGION ?? "iad",
      guest: { cpus: 1, memoryMb: 512 },
      env: { NODE_ENV: "production", PORT: "8787", EDGESPEC_PROVIDER: "node" },
      services: [
        {
          internalPort: 8787,
          ports: [
            { port: 443, handlers: ["tls", "http"] },
            { port: 80, handlers: ["http"] },
          ],
          checks: [
            {
              type: "http",
              port: 8787,
              path: "/api/health",
              interval: "15s",
              timeout: "5s",
              gracePeriod: "10s",
            },
          ],
        },
      ],
    };

    const machine = yield* Fly.Machine("EdgeSpec", machineProps);

    return { url: app.url, machine: machine.machineId };
  }),
);
