/** In-memory todos — keyed by SecureLink identity id (anon_* or user_*) */

const todosByOwner = new Map();

function list(ownerId) {
  return [...(todosByOwner.get(ownerId) ?? [])].sort((a, b) => b.createdAt - a.createdAt);
}

function create(ownerId, title) {
  const now = Date.now();
  const item = {
    id: `item_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    title: title.trim(),
    done: false,
    createdAt: now,
    updatedAt: now,
  };
  const rows = todosByOwner.get(ownerId) ?? [];
  rows.push(item);
  todosByOwner.set(ownerId, rows);
  return item;
}

function update(ownerId, id, patch) {
  const item = (todosByOwner.get(ownerId) ?? []).find((t) => t.id === id);
  if (!item) return null;
  if (typeof patch.title === "string") item.title = patch.title.trim();
  if (typeof patch.done === "boolean") item.done = patch.done;
  item.updatedAt = Date.now();
  return item;
}

function remove(ownerId, id) {
  const rows = todosByOwner.get(ownerId) ?? [];
  const next = rows.filter((t) => t.id !== id);
  if (next.length === rows.length) return false;
  todosByOwner.set(ownerId, next);
  return true;
}

export const todos = { list, create, update, remove };

/**
 * Truly public payload — never include private todos / user counts.
 */
export function publicInfo() {
  return {
    access: "public",
    product: "SecureLink Todo",
    message: "This endpoint needs no login. Private todos are never exposed here.",
  };
}
