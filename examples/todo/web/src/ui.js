import { API_URL } from "./services/publicApi.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function mountShell(root) {
  root.innerHTML = `
    <header class="header">
      <div class="header-row">
        <div>
          <h1>SecureLink Todo</h1>
          <p>Login as guest or with your account — todos belong to that user</p>
        </div>
        <div class="header-actions" id="header-actions"></div>
      </div>
      <span class="badge">${API_URL}</span>
    </header>

    <section class="panel slim" id="public-panel">
      <div class="section-label">Public</div>
      <p class="hint">No SecureLink — safe info only. Never includes anyone’s todos.</p>
      <pre class="stats" id="public-stats">Loading…</pre>
      <button type="button" class="ghost" id="refresh-stats">Refresh</button>
    </section>

    <!-- Not logged in -->
    <section class="panel" id="login-panel">
      <div class="section-label">Login</div>
      <p class="hint">Choose how to enter. Either way you get a SecureLink session and your own todos.</p>

      <button type="button" class="primary-block" id="guest-login">
        Continue as guest
        <span>Anonymous SecureLink identity</span>
      </button>

      <div class="divider"><span>or</span></div>

      <form class="composer" id="user-login-form">
        <input id="username" placeholder="username" value="alex" autocomplete="username" />
        <button type="submit">Sign in</button>
      </form>
      <p class="hint tiny">Demo token: <code>Bearer demo-&lt;username&gt;</code> (customAuth)</p>
      <p class="status" id="login-status"></p>
    </section>

    <!-- Logged in (guest or real user) -->
    <section class="panel hidden" id="app-panel">
      <div class="section-label">
        Your todos
        <span class="pill" id="session-pill">—</span>
      </div>
      <p class="hint" id="session-hint"></p>
      <form class="composer" id="todo-form">
        <input id="todo-title" placeholder="Add a todo…" autocomplete="off" />
        <button type="submit">Add</button>
      </form>
      <div id="todo-list"></div>
      <p class="status" id="app-status"></p>
    </section>
  `;

  return {
    headerActions: root.querySelector("#header-actions"),
    publicStats: root.querySelector("#public-stats"),
    refreshStats: root.querySelector("#refresh-stats"),
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

/**
 * @param {ReturnType<typeof mountShell>} ui
 * @param {"anonymous" | "customAuth"} kind
 * @param {string} [label]
 */
export function setSessionChrome(ui, kind, label) {
  if (kind === "anonymous") {
    ui.sessionPill.textContent = "Guest";
    ui.sessionPill.className = "pill";
    ui.sessionHint.textContent = label
      ? `Guest identity · ${label}. Only this guest’s todos are shown.`
      : "Guest identity. Only this guest’s todos are shown.";
  } else {
    ui.sessionPill.textContent = "Signed in";
    ui.sessionPill.className = "pill account";
    ui.sessionHint.textContent = label
      ? `Account · ${label}. Only this user’s todos are shown.`
      : "Account session. Only this user’s todos are shown.";
  }
}

export function setStatus(el, message, error = false) {
  el.textContent = message;
  el.classList.toggle("error", error);
}

export function renderItems(el, items, emptyText) {
  if (!items.length) {
    el.innerHTML = `<p class="empty">${emptyText}</p>`;
    return;
  }

  el.innerHTML = items
    .map(
      (t) => `
      <div class="todo ${t.done ? "done" : ""}" data-id="${t.id}">
        <button class="toggle" type="button" data-action="toggle">${t.done ? "Undo" : "Done"}</button>
        <div class="title">${escapeHtml(t.title)}</div>
        <button class="remove" type="button" data-action="remove">Delete</button>
      </div>`,
    )
    .join("");
}
