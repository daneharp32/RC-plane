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
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return now.getFullYear() + "-" + month + "-" + day;
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
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.originalText;
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
    ? "Choose a username and password to join the challenge."
    : "Sign in to view your flight log and weekly progress.";
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
  $("#admin-panel").hidden = user.role !== "admin";
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value + "T00:00:00");
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatLongDate(value) {
  if (!value) return "";
  const date = new Date(value + "T00:00:00");
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(date);
}

function setChallengeSummary(summary, settings, totalFlights, totalMinutes) {
  $("#stat-completed").innerHTML = String(summary.completedWeeks) + "<span>/52</span>";
  $("#stat-streak").innerHTML = String(summary.streak) + " <em>weeks</em>";
  $("#stat-missed").textContent = String(summary.missedWeeks);
  $("#stat-flights").textContent = String(totalFlights);
  $("#stat-minutes").textContent = String(totalMinutes) + " total minutes logged";
  $("#stat-progress-bar").style.width = String(summary.progressPercent) + "%";
  $("#stat-progress-label").textContent = String(summary.progressPercent) + "% of the challenge";
  $("#challenge-title").textContent = settings.title;
  $("#challenge-meta").textContent = settings.startDate
    ? "Starts " + formatLongDate(settings.startDate) + " · " + settings.timezone
    : "The administrator has not set a start date yet.";

  const status = $("#challenge-status");
  status.className = "status-pill";
  if (!settings.isActive || !settings.startDate) {
    status.classList.add("status-neutral");
    status.textContent = "Not started";
  } else if (summary.completedWeeks === 52) {
    status.classList.add("status-done");
    status.textContent = "Challenge complete";
  } else {
    status.classList.add("status-live");
    status.textContent = "In progress";
  }

  const notice = $("#challenge-notice");
  if (!settings.isActive || !settings.startDate) {
    notice.hidden = false;
    notice.textContent = "The challenge calendar will appear once an administrator chooses the official start date and activates the challenge. Flights can still be logged now.";
  } else {
    notice.hidden = true;
  }

  $("#weeks-count").textContent = summary.completedWeeks + " of 52 complete";
  $("#weeks-grid").innerHTML = summary.weeks.map(function (week) {
    const title = "Week " + week.number + (week.startDate ? " · " + week.startDate + " to " + week.endDate : "");
    const label = week.status === "completed" ? "Completed" :
      week.status === "missed" ? "Missed" :
      week.status === "current" ? "Current week" : "Upcoming";
    return '<div class="week-box ' + escapeHtml(week.status) + '" title="' +
      escapeHtml(title + " — " + label) + '" aria-label="' +
      escapeHtml(title + " — " + label) + '">' + week.number + "</div>";
  }).join("");
}

function renderFlights(flights, totalFlights) {
  $("#flight-history-count").textContent = totalFlights + " logged";
  if (!flights.length) {
    $("#flight-list").innerHTML = '<p class="empty-state">No flights logged yet. Add your first flight above to start building your record.</p>';
    return;
  }
  $("#flight-list").innerHTML = flights.map(function (flight) {
    const notes = flight.notes ? " · " + escapeHtml(flight.notes) : "";
    return '<div class="flight-row">' +
      '<div class="flight-main"><strong>' + escapeHtml(flight.aircraft) + '</strong>' +
      '<small>' + escapeHtml(formatDate(flight.flightDate)) + notes + '</small></div>' +
      '<span class="flight-duration">' + escapeHtml(flight.durationMinutes) + ' min</span>' +
      '<button class="delete-flight" type="button" data-delete-flight="' + escapeHtml(flight.id) + '" aria-label="Delete flight">Delete</button>' +
      '</div>';
  }).join("");
}

function renderLeaderboard(data) {
  const list = $("#leaderboard-list");
  if (!data || !data.leaderboard.length) {
    list.innerHTML = '<p class="empty-state">No participants yet. Invite someone to join the challenge.</p>';
    return;
  }
  list.innerHTML = data.leaderboard.map(function (entry, index) {
    return '<div class="leader-row">' +
      '<span class="leader-rank">' + (index + 1) + '</span>' +
      '<div><div class="leader-name">' + escapeHtml(entry.username) + '</div>' +
      '<div class="leader-detail">' + entry.streak + '-week streak · ' + entry.flightCount + ' flights</div></div>' +
      '<div class="leader-score">' + entry.completedWeeks + '/52<small>weeks</small></div>' +
      '</div>';
  }).join("");
}

function renderAdminOverview(data) {
  const target = $("#admin-overview");
  if (!data.participants.length) {
    target.innerHTML = '<p class="empty-state">No accounts registered yet.</p>';
    return;
  }
  target.innerHTML = data.participants.map(function (person) {
    return '<div class="admin-person"><span>' + escapeHtml(person.username) +
      (person.role === "admin" ? " · admin" : "") + '</span><span>' +
      person.completedWeeks + '/52 · ' + person.flightCount + ' flights</span></div>';
  }).join("");
}

async function loadDashboard() {
  const results = await Promise.all([api("/api/dashboard"), api("/api/leaderboard")]);
  const dashboard = results[0];
  const leaderboard = results[1];
  showSignedIn(dashboard.user);
  setChallengeSummary(
    dashboard.challenge.summary,
    dashboard.challenge.settings,
    dashboard.totalFlights,
    dashboard.totalMinutes
  );
  renderFlights(dashboard.flights, dashboard.totalFlights);
  renderLeaderboard(leaderboard);
  if (dashboard.user.role === "admin") {
    $("#admin-title").value = dashboard.challenge.settings.title;
    $("#admin-start-date").value = dashboard.challenge.settings.startDate || "";
    $("#admin-timezone").value = dashboard.challenge.settings.timezone || "America/Los_Angeles";
    $("#admin-active").checked = dashboard.challenge.settings.isActive;
    const overview = await api("/api/admin/overview");
    renderAdminOverview(overview);
  }
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
    toast("Flight added to your log.");
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
  if (!window.confirm("Delete this flight from your log?")) return;
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

$("#admin-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const message = $("#admin-message");
  showMessage(message, "", false);
  setBusy(button, true, "Saving...");
  try {
    await api("/api/admin/challenge", {
      method: "POST",
      body: {
        title: $("#admin-title").value.trim(),
        startDate: $("#admin-start-date").value || null,
        timezone: $("#admin-timezone").value.trim(),
        isActive: $("#admin-active").checked
      }
    });
    showMessage(message, "Challenge settings saved.", true);
    await loadDashboard();
  } catch (error) {
    showMessage(message, error.message, false);
  } finally {
    setBusy(button, false);
  }
});

$("#flight-date").value = localDate();
checkSession();
