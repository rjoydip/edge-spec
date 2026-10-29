/**
 * Local Docker target. Builds the same runtime image every other target uses
 * and runs it on the active Docker context (`DOCKER_BIN`/`DOCKER_HOST`).
 *
 * Runtime env comes from `infra/docker/.env` when present (see
 * `.env.example`); the container also works with no env, minus optional
 * capabilities.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as Docker from "@alchemy.run/docker";
import * as Alchemy from "alchemy";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import { stageSlug } from "../shared/stage.ts";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));

export default Alchemy.Stack(
  "EdgeSpecDocker",
  {
    state: Alchemy.localState(),
    providers: Docker.providers(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    const slug = stageSlug(stage);

    const image = yield* Docker.Image("EdgeSpecImage", {
      name: "edge-spec",
      tag: process.env.EDGESPEC_IMAGE_TAG ?? "latest",
      build: { context: "../..", dockerfile: "Dockerfile", platform: "linux/amd64" },
    });

    const container = yield* Docker.Container("EdgeSpec", {
      image,
      name: `edge-spec-${slug}`,
      ports: [{ external: 8787, internal: 8787 }],
      environment: { NODE_ENV: "production", PORT: "8787", EDGESPEC_PROVIDER: "node" },
      ...(existsSync(envFile) ? { envFiles: [envFile] } : {}),
      restart: "unless-stopped",
    });

    return { url: "http://127.0.0.1:8787", container: container.name };
  }),
);
