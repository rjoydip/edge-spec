# GitHub App and webhooks

EdgeSpec's automation path receives GitHub webhooks, verifies them, and starts
the durable `TestGenerationWorkflow`. The workflow uses the deployment's AI
binding and a short-lived GitHub App installation token. Visitor credentials are
never written into Workflow state.

A GitHub App is recommended for organizations and multiple repositories. A
single-repository webhook plus a personal access token also works.

## 1. Create the GitHub App

1. Open GitHub → **Settings → Developer settings → GitHub Apps → New GitHub
   App**.
2. Set:
   - **Homepage URL**: `https://<worker>`
   - **Webhook URL**: `https://<worker>/webhook`
   - **Webhook secret**: a long random value, for example:

     ```bash
     openssl rand -hex 32
     ```

   - **Active**: checked
   - **SSL verification**: enabled
3. Set repository permissions:

   | Permission    | Access           | Why                                    |
   | ------------- | ---------------- | -------------------------------------- |
   | Contents      | Read and write   | Read source, commit the generated test |
   | Pull requests | Read and write   | Open and update the pull request       |
   | Checks        | Read and write   | Publish the test check                 |
   | Issues        | Read and write   | Policy labels on pull requests         |
   | Metadata      | Read (automatic) | Repository metadata                    |

4. Subscribe to events:
   - **Push**
   - **Pull request**
   - **Issue comment**

   These cover generation, pull-request validation, and
   `/edgespec retest|coverage|explain`.

5. Create the app and note the numeric **App ID**. This becomes
   `GH_APP_ID`.

### Generate `GH_WEBHOOK_SECRET`

The webhook secret is a shared HMAC key. GitHub signs each delivery with it,
and the Worker recomputes the signature to reject forged requests. It is not a
GitHub token and is unrelated to `GH_TOKEN`.

Generate 32 random bytes:

```bash
openssl rand -hex 32
```

On a machine without OpenSSL:

```bash
bun -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

Copy the same value into both places:

1. The GitHub App's **Webhook secret** field (or the repository webhook's
   **Secret** field).
2. The deployment secret `GH_WEBHOOK_SECRET`.

Guidelines:

- Use at least 32 random bytes; don't use a password you typed.
- Never reuse `GH_TOKEN`, the GitHub App private key, or a provider API key.
- Changing it requires updating both GitHub and `GH_WEBHOOK_SECRET`; deliveries
  fail with `401` until they match.
- GitHub can show the last four characters when editing the App, but the full
  value is not retrievable later. Store it in a password manager.

## 2. Generate the private key

In the GitHub App settings, open **Private keys** and choose **Generate a
private key**. GitHub generates the key pair and downloads the private `.pem`
file; GitHub Apps do not support uploading your own public key. This is the only
time the private key is shown. Treat it as a password: it can mint installation
tokens for every repository where the app is installed.

Protect the file locally:

```bash
chmod 600 app.pem
```

If it leaks, delete that key in the App settings and generate a replacement.
GitHub invalidates the old key immediately.

### Why the Worker needs PKCS#8

The Worker signs a short-lived RS256 JWT with Web Crypto:

```ts
crypto.subtle.importKey(
  "pkcs8",
  keyBytes,
  {
    name: "RSASSA-PKCS1-v1_5",
    hash: "SHA-256",
  },
  false,
  ["sign"],
);
```

GitHub then exchanges that JWT for a repository-scoped installation token.
Web Crypto accepts **PKCS#8**, whose PEM header is:

```text
-----BEGIN PRIVATE KEY-----
```

A key downloaded from GitHub may use the older PKCS#1 format:

```text
-----BEGIN RSA PRIVATE KEY-----
```

If yours does, convert it once:

```bash
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in downloaded.pem -out app.pk8.pem

head -1 app.pk8.pem
# -----BEGIN PRIVATE KEY-----
```

Verify the converted key:

```bash
openssl pkey -in app.pk8.pem -noout -text >/dev/null && echo "valid PKCS#8 key"
```

The Worker also accepts a single-line secret containing literal `\n` escapes;
it converts them back to newlines before importing the key.

Never commit the private key. Do not send it to the browser and never pass it to
`TestGenerationWorkflow` as a parameter.

## 3. Install the App

Install the app on the target repository or organization. The installation id
is visible in the installation URL:

```text
https://github.com/settings/installations/<installation-id>
```

You do **not** need to store the installation id as a secret. GitHub includes it
in App webhook payloads as `installation.id`, and EdgeSpec uses it to mint a
token scoped to that repository.

## 4. Store the credentials

| Secret               | Value                                           |
| -------------------- | ----------------------------------------------- |
| `GH_APP_ID`          | Numeric App ID                                  |
| `GH_APP_PRIVATE_KEY` | PKCS#8 PEM, including the BEGIN/END lines       |
| `GH_WEBHOOK_SECRET`  | The secret from the App settings                |
| `GH_TOKEN`           | Optional PAT fallback when no App is configured |

For the Alchemy deployment, CI passes these as environment variables; the
Alchemy stack binds them as Worker secrets for `prod`. Locally, export them or
put them in `infra/cloudflare/.env` (git-ignored), then `bun run deploy`:

```bash
export GH_APP_ID=…
export GH_APP_PRIVATE_KEY="$(cat app.pk8.pem)"
export GH_WEBHOOK_SECRET=…
```

In GitHub Actions, store the full PEM as the `GH_APP_PRIVATE_KEY` repository
secret.

## 5. Redirect URI and `/auth`

GitHub App settings include **User authorization callback URL** (often called
the redirect URI). It is only used when you request GitHub OAuth user
authorization and call:

```text
https://github.com/login/oauth/authorize
```

EdgeSpec does **not** use GitHub OAuth user sign-in. It uses a personal access
token from the dashboard, sent as `x-github-token`. You can leave the redirect
URI blank. If you set it, use:

```text
https://<worker>/auth
```

`GET /auth` is implemented and responds without exchanging tokens:

| Request                                          | Response                                        |
| ------------------------------------------------ | ----------------------------------------------- |
| `/auth`                                          | `200` — callback page                           |
| `/auth?installation_id=123&setup_action=install` | `200` — App installation confirmed              |
| `/auth?error=access_denied`                      | `400` — authorization failed                    |
| `/auth?code=…`                                   | `501` — OAuth sign-in is not enabled; use a PAT |

The `501` is deliberate. A real OAuth callback needs a client secret, a
CSRF-protected `state` value, and a session/token-delivery design. None of those
are part of the current per-request-token model. Do not enable “Request user
authorization (OAuth) during installation” unless that flow is implemented.

The App's **Setup URL** (post-installation redirect) can also point at
`https://<worker>/auth`; the installation id arrives as a query parameter.

## 6. Webhook endpoint

Point the App or repository webhook at:

```text
https://<worker>/webhook
```

For a repository webhook (without an App):

1. Repository → **Settings → Webhooks → Add webhook**.
2. Payload URL: `https://<worker>/webhook`.
3. Content type: `application/json`.
4. Secret: the same value as `GH_WEBHOOK_SECRET`.
5. Events: **Push**, **Pull request**, **Issue comment**.
6. Set `GH_TOKEN` to a PAT with:

   - Classic token: `repo`.
   - Fine-grained token: **Contents: read and write** and **Pull requests:
     read and write** on the target repositories.

Without an App, the payload has no `installation.id`, so the workflow falls back
to `GH_TOKEN`.

## 7. Verify

1. Open the App's **Advanced → Recent Deliveries** and redeliver a `push`.
2. Expected response:
   - Valid run: `202` with `{ "workflowId": "…" }`.
   - Ignored event: `202` with an `ignored` reason.
   - Invalid signature: `401`.
3. Poll the run:

   ```bash
   curl -s https://<worker>/api/runs/<workflowId>
   ```

4. Confirm the generated pull request and check appear on the repository.

## Troubleshooting

- **`Invalid webhook signature`**: the App/repository secret and
  `GH_WEBHOOK_SECRET` differ. Update both.
- **`The GitHub App private key is not a valid PKCS#8 PEM`**: the key is still
  PKCS#1. Run the `openssl pkcs8` conversion above.
- **`GitHub App token request returned 401/404`**: check the App ID, install the
  app on the repository, and confirm the payload contains `installation.id`.
- **Workflow never starts**: confirm `TEST_GENERATION_WORKFLOW` is bound and the
  deploy included the Workflows binding.
- **Tests are static-only**: webhook runs have no per-user sandbox headers. Set
  an optional deployment fallback or accept static validation.

See [Deployment](/deployment) for the Cloudflare bindings and secrets, and
[Configuration](/configuration) for the user-facing sandbox settings.
