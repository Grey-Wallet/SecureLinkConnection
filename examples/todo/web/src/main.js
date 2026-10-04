import "./styles.css";
import * as publicApi from "./services/publicApi.js";
import { anonymousClient, loginAsGuest } from "./services/securelink.js";
import {
  hasStoredUser,
  loginAsUser,
  logoutUser,
  restoreUserSession,
} from "./services/account.js";
import { createTodoService } from "./services/todos.js";
import {
  mountShell,
  renderItems,
  setSessionChrome,
  setStatus,
  setView,
} from "./ui.js";

const ui = mountShell(document.querySelector("#app"));

/** @type {ReturnType<typeof createTodoService> | null} */
let todos = null;

async function loadPublic() {
  const info = await publicApi.getPublicInfo();
  ui.publicStats.textContent = JSON.stringify(info, null, 2);
}

async function refreshTodos() {
  if (!todos) return;
  renderItems(ui.todoList, await todos.list(), "No todos yet. Add one above.");
}

function wireLogout() {
  const btn = document.querySelector("#logout-btn");
  if (!btn) return;
  btn.onclick = () => {
    logoutUser();
    todos = null;
    setView(ui, "login");
    setStatus(ui.loginStatus, "Logged out.");
    void loadPublic();
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
  await refreshTodos();
  setStatus(ui.appStatus, "Ready.");
  await loadPublic();
}

async function boot() {
  try {
    await loadPublic();
  } catch (err) {
    ui.publicStats.textContent = err instanceof Error ? err.message : "Public API failed";
  }

  if (hasStoredUser()) {
    try {
      const session = await restoreUserSession();
      if (session) {
        await enterApp("customAuth", session.client, session.userId);
        return;
      }
    } catch {
      logoutUser();
    }
  }

  setView(ui, "login");
}

ui.refreshStats.addEventListener("click", () => void loadPublic());

ui.guestLogin.addEventListener("click", async () => {
  try {
    setStatus(ui.loginStatus, "Starting guest session…");
    await loginAsGuest();
    const id = (await anonymousClient.session.get()).identity?.id;
    await enterApp("anonymous", anonymousClient, id);
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
    await refreshTodos();
  } catch (err) {
    setStatus(ui.appStatus, err instanceof Error ? err.message : "Failed", true);
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
    await refreshTodos();
  } catch (err) {
    setStatus(ui.appStatus, err instanceof Error ? err.message : "Failed", true);
  }
});

void boot();
