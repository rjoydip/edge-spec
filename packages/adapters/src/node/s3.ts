/**
 * S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, Supabase) over
 * `aws4fetch`. Node/Bun only: never reachable from the Cloudflare entry.
 */
import { AwsClient } from "aws4fetch";
import type { ObjectStore } from "@edge-spec/runtime/env";

export interface S3Options {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
}

export function s3Store(options: S3Options): ObjectStore {
  const client = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    service: "s3",
    region: options.region,
    // aws4fetch retries 5xx and 429 ten times by default, sleeping up to
    // ~50 s in total before it gives up: a stalled artifact write the pipeline
    // cannot report. Two retries still ride out a transient S3 hiccup and fail
    // in well under a second.
    retries: 2,
    initRetryMs: 50,
  });
  const base = `${options.endpoint.replace(/\/+$/, "")}/${options.bucket}`;
  const urlFor = (key: string) => {
    const full = options.prefix ? `${options.prefix}/${key}` : key;
    return `${base}/${full.split("/").map(encodeURIComponent).join("/")}`;
  };

  return {
    async put(key, value, putOptions) {
      const response = await client.fetch(urlFor(key), {
        method: "PUT",
        body: value,
        headers: { "content-type": putOptions?.httpMetadata?.contentType ?? "text/plain" },
      });
      if (!response.ok) throw new Error(`S3 PUT ${key} returned ${response.status}.`);
      return response;
    },
    async get(key) {
      const response = await client.fetch(urlFor(key));
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`S3 GET ${key} returned ${response.status}.`);
      return { text: () => response.text() };
    },
    async delete(key) {
      const response = await client.fetch(urlFor(key), { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        throw new Error(`S3 DELETE ${key} returned ${response.status}.`);
      }
    },
    async list(prefix) {
      const physical = options.prefix ? `${options.prefix}/${prefix}` : prefix;
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const query = new URLSearchParams({ "list-type": "2", prefix: physical });
        if (token) query.set("continuation-token", token);
        const response = await client.fetch(`${base}?${query}`);
        if (!response.ok) throw new Error(`S3 LIST ${prefix} returned ${response.status}.`);
        const xml = await response.text();
        for (const match of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) {
          const key = decodeXml(match[1] ?? "");
          keys.push(options.prefix ? key.slice(options.prefix.length + 1) : key);
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? decodeXml(
              /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "",
            )
          : undefined;
      } while (token);
      return keys;
    },
  };
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
