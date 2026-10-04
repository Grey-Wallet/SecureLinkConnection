/**
 * Unified todo API for whoever is logged in (guest or signed-in user).
 */
export function createTodoService(client) {
  function fail(message) {
    throw new Error(message);
  }

  return {
    async list() {
      const res = await client.request({ method: "GET", path: "/api/todos" });
      if (!res.ok || !res.data) fail(res.error?.message ?? "Failed to load todos");
      return res.data.items;
    },
    async create(title) {
      const res = await client.request({
        method: "POST",
        path: "/api/todos",
        body: { title },
      });
      if (!res.ok) fail(res.error?.message ?? "Create failed");
    },
    async setDone(id, done) {
      const res = await client.request({
        method: "PATCH",
        path: `/api/todos/${id}`,
        body: { done },
      });
      if (!res.ok) fail(res.error?.message ?? "Update failed");
    },
    async remove(id) {
      const res = await client.request({
        method: "DELETE",
        path: `/api/todos/${id}`,
      });
      if (!res.ok) fail(res.error?.message ?? "Delete failed");
    },
  };
}
