/**
 * Kubernetes target. Builds `Dockerfile` and applies a Deployment on any
 * cluster `kubectl` can reach, or on a local kind cluster when
 * `ALCHEMY_DEV=1`.
 *
 * Set `KUBE_CONTEXT` to pin a kubeconfig context and `KUBE_REGISTRY` to the
 * registry the nodes pull from. Without a registry, a `context` build fails
 * before anything is applied (kind fills one in automatically).
 */
import * as Kubernetes from "@alchemy.run/kubernetes";
import * as Alchemy from "alchemy";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import { stageSlug } from "../shared/stage.ts";

export default Alchemy.Stack(
  "EdgeSpecKubernetes",
  {
    state: Alchemy.localState(),
    providers: Kubernetes.providers(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    const isProd = stage === "prod";
    const slug = stageSlug(stage);
    const local = /^(1|true)$/i.test(process.env.ALCHEMY_DEV ?? "");

    const cluster = local
      ? yield* Kubernetes.LocalCluster("EdgeSpecCluster", { name: `edge-spec-${slug}` })
      : Kubernetes.KubeConfig({
          ...(process.env.KUBE_CONTEXT ? { context: process.env.KUBE_CONTEXT } : {}),
          ...(process.env.KUBE_REGISTRY ? { registry: { server: process.env.KUBE_REGISTRY } } : {}),
        });

    const deployment = yield* Kubernetes.Deployment("EdgeSpec", {
      cluster,
      context: "../..",
      port: 8787,
      env: { EDGESPEC_PROVIDER: "node" },
      replicas: isProd ? 2 : 1,
      // kind has no load balancer; a hosted cluster gets a public Service.
      serviceType: local ? "ClusterIP" : "LoadBalancer",
      resources: {
        requests: { cpu: "100m", memory: "256Mi" },
        limits: { memory: "512Mi" },
      },
    });

    return { service: deployment.serviceName, url: deployment.url };
  }),
);
