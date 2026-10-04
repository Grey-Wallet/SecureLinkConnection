import { getPublicInfo } from "./services/publicApi.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function mountShell(root) {
  root.innerHTML = `
    <header>
      <div class="header-row">
        <div>
          <h1>SecureLink Todo</h1>
          <p>Guest or sign in · todos belong to that user</p>
        </div>
        <div id="header-actions"></div>
      </div>
    </header>

    <section>
      <div class="label">Public</div>
      <pre id="stats" class="stats">…</pre>
    </section>

    <section id="login-panel">
      <div class="label">Login</div>
      <button type="button" class="primary-block" id="guest-login">
        Continue as guest
      </button>
      <div class="divider">or</div>
      <form id="user-login-form" class="composer">
        <input id="username" placeholder="username" value="alex" />
        <button type="submit">Sign in</button>
      </form>
      <p id="login-status" class="status"></p>
    </section>

    <section id="app-panel" class="hidden">
      <div class="label">Your todos <span id="session-pill" class="pill">—</span></div>
      <p id="session-hint" class="hint"></p>
      <form id="todo-form" class="composer">
        <input id="todo-title" placeholder="Add a todo…" />
        <button type="submit">Add</button>
      </form>
      <div id="todo-list"></div>
      <p id="app-status" class="status"></p>
    </section>
  `;

  return {
    headerActions: root.querySelector("#header-actions"),
    stats: root.querySelector("#stats"),
    loginPanel: root.querySelector("#login-panel"),
    appPanel: root.querySelector("#app-panel"),
    guestLogin: root.querySelector("#guest-login"),
    userLoginForm: root.querySelector("#user-login-form"),
    username: root.querySelector("#username"),
    loginStatus: root.querySelector("#login-status"),
    sessionPill: root.querySelector("#session-pill"),
    sessionHint: root.querySelector("#session-hint"),
    todoForm: root.querySelector("#todo-form"),
    todoTitle: root.querySelector("#todo-title"),
    todoList: root.querySelector("#todo-list"),
    appStatus: root.querySelector("#app-status"),
  };
}

/** @param {"login" | "app"} view */
export function setView(ui, view) {
  ui.loginPanel.classList.toggle("hidden", view !== "login");
  ui.appPanel.classList.toggle("hidden", view !== "app");
  if (view === "app") {
    ui.headerActions.innerHTML =
      `<button type="button" class="ghost" id="logout-btn">Log out</button>`;
  } else {
    ui.headerActions.innerHTML = "";
  }
}

export function setSessionChrome(ui, kind, label) {
  if (kind === "anonymous") {
    ui.sessionPill.textContent = "Guest";
    ui.sessionHint.textContent = label
      ? `Guest · ${label}`
      : "Guest identity";
  } else {
    ui.sessionPill.textContent = "Signed in";
    ui.sessionHint.textContent = label
      ? `Account · ${label}`
      : "Account session";
  }
}

export function setStatus(el, msg, error = false) {
  el.textContent = msg;
  el.classList.toggle("error", error);
}

export function renderTodos(el, todos) {
  if (!todos.length) {
    el.innerHTML = `<p class="empty">No todos yet.</p>`;
    return;
  }
  el.innerHTML = todos
    .map(
      (t) => `
      <div class="todo ${t.done ? "done" : ""}" data-id="${t.id}">
        <button data-action="toggle" type="button">${t.done ? "Undo" : "Done"}</button>
        <span>${escapeHtml(t.title)}</span>
        <button data-action="remove" class="danger" type="button">Del</button>
      </div>`,
    )
    .join("");
}

export async function fillPublicStats(el) {
  try {
    el.textContent = JSON.stringify(await getPublicInfo(), null, 2);
  } catch (err) {
    el.textContent = err instanceof Error ? err.message : "Failed";
  }
}
