export const API_URL =
  process.env.EXPO_PUBLIC_SECURELINK_URL ?? "http://127.0.0.1:8787";

export async function getPublicInfo() {
  const res = await fetch(`${API_URL}/api/public/info`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error?.message ?? "Public failed");
  return json.data;
}
