const $ = function (selector) { return document.querySelector(selector); };
let authMode = "login";
let toastTimer = null;

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function localDate() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") +
    "-" + String(now.getDate()).padStart(2, "0");
}

function showMessage(element, message, success) {
  element.textContent = message || "";
  element.classList.toggle("success", Boolean(success));
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { element.classList.remove("visible"); }, 3000);
}

async function api(path, options) {
  const settings = options || {};
  const headers = new Headers(settings.headers || {});
  if (settings.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    method: settings.method || "GET",
    headers: headers,
    body: settings.body === undefined ? undefined : JSON.stringify(settings.body),
    credentials: "same-origin"
  });
  let data = {};
  try { data = await response.json(); } catch (_error) { data = {}; }
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

function setBusy(button, busy, busyText) {
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

function setAuthMode(mode) {
  authMode = mode;
  const register = mode === "register";
  $("#login-tab").classList.toggle("active", !register);
  $("#register-tab").classList.toggle("active", register);
  $("#login-tab").setAttribute("aria-selected", String(!register));
  $("#register-tab").setAttribute("aria-selected", String(register));
  $("#auth-title").textContent = register ? "Create your account" : "Welcome back";
  $("#auth-subtitle").textContent = register
    ? "Choose a username and password to start your journal."
    : "Sign in to view your personal flight journal.";
  $("#auth-submit").textContent = register ? "Create account" : "Sign in";
  $("#auth-password").setAttribute("autocomplete", register ? "new-password" : "current-password");
  $("#password-help").textContent = register ? "Use at least 10 characters." : "Enter your account password.";
  showMessage($("#auth-message"), "", false);
}

function showSignedOut() {
  $("#auth-section").hidden = false;
  $("#app-section").hidden = true;
  $("#account-area").hidden = true;
  $("#auth-form").reset();
  setAuthMode("login");
}

function showSignedIn(user) {
  $("#auth-section").hidden = true;
  $("#app-section").hidden = false;
  $("#account-area").hidden = false;
  $("#account-name").textContent = user.username;
  $("#welcome-name").textContent = user.username;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value + "T00:00:00");
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function renderFlights(flights, totalFlights) {
  $("#flight-history-count").textContent = totalFlights + " recorded";
  if (!flights.length) {
    $("#flight-list").innerHTML = '<p class="empty-state">No flights recorded yet. Add details for a completed flight to start your journal.</p>';
    return;
  }
  $("#flight-list").innerHTML = flights.map(function (flight) {
    const notes = flight.notes ? '<p class="flight-notes">' + escapeHtml(flight.notes) + "</p>" : "";
    return '<article class="flight-entry">' +
      '<div class="flight-entry-main"><div class="flight-title">' + escapeHtml(flight.aircraft) + '</div>' +
      '<div class="flight-date">' + escapeHtml(formatDate(flight.flightDate)) + '</div>' + notes + '</div>' +
      '<div class="flight-entry-side"><strong>' + escapeHtml(flight.durationMinutes) + ' min</strong>' +
      '<button class="delete-flight" type="button" data-delete-flight="' + escapeHtml(flight.id) + '" aria-label="Delete flight">Delete</button></div>' +
      '</article>';
  }).join("");
}

async function loadDashboard() {
  const dashboard = await api("/api/dashboard");
  showSignedIn(dashboard.user);
  $("#stat-flights").textContent = String(dashboard.totalFlights);
  $("#stat-minutes").innerHTML = String(dashboard.totalMinutes) + " <em>min</em>";
  $("#stat-days").textContent = String(dashboard.flyingDays);
  $("#stat-latest").textContent = dashboard.flights.length ? formatDate(dashboard.flights[0].flightDate) : "—";
  renderFlights(dashboard.flights, dashboard.totalFlights);
}

async function checkSession() {
  try {
    const result = await api("/api/me");
    if (result.user) await loadDashboard();
    else showSignedOut();
  } catch (error) {
    showSignedOut();
    showMessage($("#auth-message"), error.message, false);
  }
}

$("#login-tab").addEventListener("click", function () { setAuthMode("login"); });
$("#register-tab").addEventListener("click", function () { setAuthMode("register"); });

$("#auth-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  const button = $("#auth-submit");
  const message = $("#auth-message");
  showMessage(message, "", false);
  setBusy(button, true, authMode === "register" ? "Creating..." : "Signing in...");
  try {
    await api(authMode === "register" ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      body: { username: $("#auth-username").value.trim(), password: $("#auth-password").value }
    });
    await loadDashboard();
  } catch (error) {
    showMessage(message, error.message, false);
  } finally {
    setBusy(button, false);
  }
});

$("#logout-button").addEventListener("click", async function () {
  try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch (_error) {}
  showSignedOut();
});

$("#flight-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const message = $("#flight-message");
  showMessage(message, "", false);
  setBusy(button, true, "Saving...");
  try {
    await api("/api/flights", {
      method: "POST",
      body: {
        flightDate: $("#flight-date").value,
        aircraft: $("#flight-aircraft").value,
        durationMinutes: Number($("#flight-duration").value),
        notes: $("#flight-notes").value
      }
    });
    event.currentTarget.reset();
    $("#flight-date").value = localDate();
    showMessage(message, "Flight saved.", true);
    await loadDashboard();
    toast("Flight added to your journal.");
  } catch (error) {
    showMessage(message, error.message, false);
  } finally {
    setBusy(button, false);
  }
});

$("#flight-list").addEventListener("click", async function (event) {
  const button = event.target.closest("[data-delete-flight]");
  if (!button) return;
  const id = button.getAttribute("data-delete-flight");
  if (!window.confirm("Delete this flight from your journal?")) return;
  button.disabled = true;
  try {
    await api("/api/flights/" + encodeURIComponent(id), { method: "DELETE" });
    await loadDashboard();
    toast("Flight deleted.");
  } catch (error) {
    button.disabled = false;
    toast(error.message);
  }
});

$("#flight-date").value = localDate();
checkSession();
