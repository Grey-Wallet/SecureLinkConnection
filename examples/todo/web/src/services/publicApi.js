export const API_URL =
  import.meta.env.VITE_SECURELINK_URL ?? "http://127.0.0.1:8787";

/** Plain fetch — no SecureLink (public routes only) */
export async function getPublic(path) {
  const res = await fetch(`${API_URL}${path}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error?.message ?? "Public request failed");
  return json.data;
}

export function getHealth() {
  return getPublic("/api/health");
}

/** Public info — never returns private todos */
export function getPublicInfo() {
  return getPublic("/api/public/info");
}
