import "./popup.css";
import { loginAsGuest } from "./services/securelink.js";
import {
  hasStoredUser,
  loginAsUser,
  logoutUser,
  restoreUserSession,
} from "./services/account.js";
import { createTodoService } from "./services/todos.js";
import {
  fillPublicStats,
  mountShell,
  renderTodos,
  setSessionChrome,
  setStatus,
  setView,
} from "./ui.js";

const ui = mountShell(document.querySelector("#app"));

/** @type {ReturnType<typeof createTodoService> | null} */
let todos = null;

async function refresh() {
  if (!todos) return;
  renderTodos(ui.todoList, await todos.list());
}

function wireLogout() {
  const btn = document.querySelector("#logout-btn");
  if (!btn) return;
  btn.onclick = () => {
    void (async () => {
      await logoutUser();
      todos = null;
      setView(ui, "login");
      setStatus(ui.loginStatus, "Logged out.");
      await fillPublicStats(ui.stats);
    })();
  };
}

/**
 * @param {"anonymous" | "customAuth"} kind
 * @param {*} client
 * @param {string} [label]
 */
async function enterApp(kind, client, label) {
  todos = createTodoService(client);
  setView(ui, "app");
  setSessionChrome(ui, kind, label);
  wireLogout();
  await refresh();
  setStatus(ui.appStatus, "Ready.");
  await fillPublicStats(ui.stats);
}

async function boot() {
  await fillPublicStats(ui.stats);

  if (await hasStoredUser()) {
    try {
      const session = await restoreUserSession();
      if (session) {
        await enterApp("customAuth", session.client, session.userId);
        return;
      }
    } catch {
      await logoutUser();
    }
  }

  setView(ui, "login");
}

ui.guestLogin.addEventListener("click", async () => {
  try {
    setStatus(ui.loginStatus, "Starting guest session…");
    const session = await loginAsGuest();
    await enterApp("anonymous", session.client, session.userId);
  } catch (err) {
    setStatus(ui.loginStatus, err instanceof Error ? err.message : "Guest login failed", true);
  }
});

ui.userLoginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    setStatus(ui.loginStatus, "Signing in…");
    const session = await loginAsUser(ui.username.value);
    await enterApp("customAuth", session.client, session.userId);
  } catch (err) {
    setStatus(ui.loginStatus, err instanceof Error ? err.message : "Sign in failed", true);
  }
});

ui.todoForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!todos) return;
  const title = ui.todoTitle.value.trim();
  if (!title) return;
  ui.todoTitle.value = "";
  try {
    await todos.create(title);
    await refresh();
    await fillPublicStats(ui.stats);
  } catch (err) {
    setStatus(ui.appStatus, err instanceof Error ? err.message : "Create failed", true);
  }
});

ui.todoList.addEventListener("click", async (e) => {
  if (!todos) return;
  const btn = e.target.closest("button");
  const row = e.target.closest(".todo");
  if (!btn || !row) return;
  try {
    if (btn.dataset.action === "toggle") {
      await todos.setDone(row.dataset.id, !row.classList.contains("done"));
    }
    if (btn.dataset.action === "remove") {
      await todos.remove(row.dataset.id);
    }
    await refresh();
    await fillPublicStats(ui.stats);
  } catch (err) {
    setStatus(ui.appStatus, err instanceof Error ? err.message : "Action failed", true);
  }
});

void boot();
