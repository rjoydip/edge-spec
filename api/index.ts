/** Vercel only discovers functions under `api/`; the handler lives in `infra/vercel`. */
export { GET, POST, PUT, PATCH, DELETE, OPTIONS } from "../infra/vercel/handler";
