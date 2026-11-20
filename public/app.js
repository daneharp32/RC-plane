const $ = function (selector) { return document.querySelector(selector); };

let authMode = "login";
let currentUser = null;
let currentGroup = null;

const dashboardGreetingMessages = [
  "Welcome, {username}!",
  "Good flying, {username}?",
  "Good day, {username}!",
  "Batteries charged, {username}?"
];
let dashboardGreetingIndex = 0;

try {
  const savedGreetingIndex = Number.parseInt(localStorage.getItem("flyers-greeting-cycle"), 10);
  if (Number.isInteger(savedGreetingIndex) && savedGreetingIndex >= 0 &&
      savedGreetingIndex < dashboardGreetingMessages.length) {
    dashboardGreetingIndex = savedGreetingIndex;
  }
  localStorage.setItem(
    "flyers-greeting-cycle",
    String((dashboardGreetingIndex + 1) % dashboardGreetingMessages.length)
  );
} catch (_error) {}

function renderDashboardGreeting(username) {
  const greeting = dashboardGreetingMessages[dashboardGreetingIndex] || dashboardGreetingMessages[0];
  const element = $("#dashboard-greeting");
  if (element) element.textContent = greeting.replace("{username}", username || "pilot");
}
let selectedPlanes = [];
let knownPlanes = [];
let selectedPhotoBase64 = "";
let selectedFunPhotoBase64 = "";
let selectedHangarPhotoBase64 = "";
let selectedAvatarBase64 = "";
let activeHangarUserId = null;
let activeHangarUsername = "";
let activeHangarIsMine = true;
let feedState = {
  posts: [],
  hasMore: false,
  nextCursor: null,
  loading: false
};

let toastTimer = null;
let feedPollTimer = null;

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
function applyTheme(theme, savePreference) {
  const selected = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selected;
  const isDark = selected === "dark";
  $("#theme-toggle").setAttribute("aria-pressed", String(isDark));
  $("#theme-toggle").setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  $("#theme-toggle-icon").textContent = isDark ? "☀" : "☾";
  $("#theme-toggle-label").textContent = isDark ? "Light mode" : "Dark mode";
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute("content", isDark ? "#111a22" : "#f3f6f8");
  if (savePreference) {
    try { localStorage.setItem("flyers-theme", selected); } catch (_error) {}
  }
}

function initializeTheme() {
  let savedTheme = "light";
  try {
    savedTheme = localStorage.getItem("flyers-theme") || "light";
  } catch (_error) {}
  applyTheme(savedTheme, false);
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
    ? "Choose a username and password to join the flight journal."
    : "Sign in to view the group flight feed.";
  $("#auth-submit").textContent = register ? "Create account" : "Sign in";
  $("#auth-password").setAttribute("autocomplete", register ? "new-password" : "current-password");
  $("#password-help").textContent = register ? "Use at least 6 characters." : "Enter your account password.";
  showMessage($("#auth-message"), "", false);
}

function showSignedOut() {
  stopFeedPolling();
  currentUser = null;
  currentGroup = null;
  activeHangarUserId = null;
  activeHangarUsername = "";
  activeHangarIsMine = true;
  selectedHangarPhotoBase64 = "";
  clearFunPhoto();
  selectedAvatarBase64 = "";
  $("#auth-section").hidden = false;
  $("#group-setup-section").hidden = true;
  $("#app-section").hidden = true;
  $("#account-area").hidden = true;
  $("#group-tab").hidden = true;
  $("#admin-tab").hidden = true;
  $("#auth-form").reset();
  setAuthMode("login");
}

function showSignedIn(user) {
  currentUser = user;
  const hasGroup = Boolean(user.groupId);
  $("#auth-section").hidden = true;
  $("#group-setup-section").hidden = hasGroup;
  $("#app-section").hidden = !hasGroup || !currentGroup;
  $("#account-area").hidden = false;
  $("#account-name").textContent = user.username;
  renderDashboardGreeting(user.username);
  $("#group-tab").hidden = !hasGroup;
  $("#admin-tab").hidden = !hasGroup || !user.isAdmin;
  renderTopbarAvatar(user.avatarBase64 || "", user.username);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value + "T00:00:00");
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit"
  }).format(date);
}

function avatarMarkup(base64, username, className) {
  const initial = username ? username.slice(0, 1).toUpperCase() : "?";
  if (base64) {
    return '<img class="' + className + '" src="data:image/jpeg;base64,' +
      escapeHtml(base64) + '" alt="' + escapeHtml(username || "Group member") + ' profile picture">';
  }
  return '<span class="' + className + ' avatar-fallback" aria-hidden="true">' +
    escapeHtml(initial) + '</span>';
}

function spotLabel(post) {
  const labels = {
    chill_guy: "Chill Guy",
    unc_road: "Unc Road",
    sports_park: "Sports Park",
    shore_cliffs: "Shore Cliffs",
    other: post.otherSpot || "Other spot"
  };
  return labels[post.spot] || "Flying spot";
}

function renderFunPost(post) {
  const photo = post.photoBase64
    ? '<div class="post-photo-wrap fun-post-photo-wrap"><img class="post-photo" src="data:image/jpeg;base64,' +
      escapeHtml(post.photoBase64) + '" alt="Photo shared by ' + escapeHtml(post.username) + '" loading="lazy"></div>'
    : "";
  const text = post.description
    ? '<p class="fun-post-text">' + escapeHtml(post.description) + '</p>'
    : "";
  return '<article class="post-card fun-post-card" data-post-id="' + escapeHtml(post.id) + '">' +
    '<div class="fun-post-banner"><strong>✦ COMMUNITY POST</strong>' +
      '<span>JUST FOR FUN · NOT PART OF THE FLIGHT CHALLENGE</span></div>' +
    '<header class="post-header fun-post-header">' +
      '<div class="post-author">' +
        avatarMarkup(post.avatarBase64 || "", post.username, "avatar") +
        '<div class="post-author-copy"><strong>' + escapeHtml(post.username) + '</strong>' +
        '<small>Shared with the group</small></div>' +
      '</div>' +
      '<time class="post-time" datetime="' + escapeHtml(post.createdAt) + '">' +
        escapeHtml(formatTimestamp(post.createdAt)) + '</time>' +
    '</header>' +
    photo +
    '<div class="fun-post-body">' + text + '</div>' +
  '</article>';
}

function renderPost(post) {
  if (post.postType === "fun") return renderFunPost(post);
  const photoSrc = "data:image/jpeg;base64," + post.photoBase64;
  const planes = Array.isArray(post.planes) ? post.planes : [];
  const initial = post.username ? post.username.slice(0, 1).toUpperCase() : "?";
  const description = post.description
    ? '<p class="post-description">' + escapeHtml(post.description) + "</p>"
    : "";
  return '<article class="post-card" data-post-id="' + escapeHtml(post.id) + '">' +
    '<header class="post-header">' +
      '<div class="post-author">' +
        avatarMarkup(post.avatarBase64 || "", post.username, "avatar") +
        '<div class="post-author-copy"><strong>' + escapeHtml(post.username) + '</strong>' +
        '<small>Flight date: ' + escapeHtml(formatDate(post.flightDate)) + "</small></div>" +
      "</div>" +
      '<time class="post-time" datetime="' + escapeHtml(post.createdAt) + '">' +
        escapeHtml(formatTimestamp(post.createdAt)) + "</time>" +
    "</header>" +
    '<div class="post-photo-wrap"><img class="post-photo" src="' + photoSrc +
      '" alt="RC plane at ' + escapeHtml(spotLabel(post)) + '" loading="lazy"></div>' +
    '<div class="post-body">' +
      '<div class="post-meta"><span class="post-chip flight-kind">✈ FLIGHT LOG</span><span class="post-chip spot">⌖ ' + escapeHtml(spotLabel(post)) +
      '</span><span class="post-chip">✈ ' + planes.length + (planes.length === 1 ? " plane" : " planes") + "</span></div>" +
      '<p class="post-plane-label">Aircraft flown</p><div class="post-planes">' +
        planes.map(function (plane) { return '<span class="post-plane">' + escapeHtml(plane) + "</span>"; }).join("") +
      "</div>" + description +
    "</div>" +
  "</article>";
}

function renderFeed() {
  const list = $("#feed-list");
  if (!feedState.posts.length) {
    list.innerHTML = '<div class="feed-empty"><strong>No posts yet</strong>Share a completed flight log or add a fun post for your group.</div>';
  } else {
    list.innerHTML = feedState.posts.map(renderPost).join("");
  }
  $("#load-older-button").hidden = !feedState.hasMore;
  $("#feed-end").hidden = !feedState.posts.length;
}

async function loadFeed(older) {
  if (feedState.loading) return;
  if (older && (!feedState.hasMore || !feedState.nextCursor)) return;

  feedState.loading = true;
  $("#feed-loading").hidden = !older;
  $("#load-older-button").disabled = true;
  showMessage($("#feed-message"), "", false);

  const scroller = $("#feed-scroller");
  const oldHeight = scroller.scrollHeight;
  const oldTop = scroller.scrollTop;

  try {
    let path = "/api/feed";
    if (older && feedState.nextCursor) {
      const query = new URLSearchParams({
        beforeCreatedAt: feedState.nextCursor.createdAt,
        beforeId: feedState.nextCursor.id
      });
      path += "?" + query.toString();
    }

    const result = await api(path);
    const chronological = result.posts.slice().reverse();
    if (older) {
      feedState.posts = chronological.concat(feedState.posts);
    } else {
      feedState.posts = chronological;
    }
    feedState.hasMore = Boolean(result.hasMore);
    feedState.nextCursor = result.nextCursor;
    renderFeed();

    requestAnimationFrame(function () {
      if (older) {
        scroller.scrollTop = oldTop + (scroller.scrollHeight - oldHeight);
      } else {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
  } catch (error) {
    showMessage($("#feed-message"), error.message, false);
  } finally {
    feedState.loading = false;
    $("#feed-loading").hidden = true;
    $("#load-older-button").disabled = false;
  }
}

async function loadMyLogs() {
  showMessage($("#my-logs-message"), "", false);
  try {
    const [dashboard, result] = await Promise.all([
      api("/api/dashboard"),
      api("/api/feed?mine=1")
    ]);
    $("#stat-posts").textContent = String(dashboard.totalPosts);
    $("#stat-days").textContent = String(dashboard.flyingDays);
    $("#stat-planes").textContent = String(dashboard.uniquePlanes);
    if (!result.posts.length) {
      $("#my-posts-list").innerHTML = '<div class="feed-empty"><strong>Your flight log is empty</strong>Use Log flight to add your first completed session.</div>';
    } else {
      $("#my-posts-list").innerHTML = result.posts.map(renderPost).join("");
    }
    updatePlaneSuggestions(dashboard.knownPlanes || []);
  } catch (error) {
    showMessage($("#my-logs-message"), error.message, false);
  }
}


function renderAdminOverview(data) {
  const challenge = data.challenge || { status: "not_started" };
  const labels = {
    not_started: "Not started",
    scheduled: "Scheduled",
    active: "Active",
    ended: "Ended"
  };
  const start = challenge.startDate ? formatDate(challenge.startDate) : "";
  const end = challenge.endDate ? formatDate(challenge.endDate) : "";
  let detail = "The challenge has not started. Choose a date to open the optional 360-day journal window.";
  if (challenge.status === "scheduled") {
    detail = "The window is scheduled from " + start + " through " + end + ". You can end it early if plans change.";
  } else if (challenge.status === "active") {
    detail = "The window runs from " + start + " through " + end + ". It is an optional journal period, not a requirement to fly.";
  } else if (challenge.status === "ended") {
    const ended = challenge.endedAt ? formatDate(challenge.endedAt) : end;
    detail = ended
      ? "The previous window ended on " + ended + ". You can start a new 360-day window."
      : "The previous challenge window has ended. You can start a new one.";
  }
  $("#admin-challenge-status").textContent = labels[challenge.status] || "Not started";
  $("#admin-challenge-status").dataset.status = challenge.status || "not_started";
  $("#admin-challenge-detail").textContent = detail;
  if (!$("#admin-challenge-start-date").value || challenge.startDate) {
    $("#admin-challenge-start-date").value = challenge.startDate || localDate();
  }
  const underway = challenge.status === "active" || challenge.status === "scheduled";
  $("#admin-start-challenge-button").hidden = underway;
  $("#admin-start-challenge-button").textContent =
    challenge.status === "ended" ? "Restart 360-day window" : "Start 360-day window";
  $("#admin-end-challenge-button").hidden = !underway;

  const posts = Array.isArray(data.posts) ? data.posts : [];
  $("#admin-post-count").textContent = String(posts.length);
  $("#admin-posts-list").innerHTML = posts.length
    ? posts.map(function (post) {
        const isFunPost = post.postType === "fun";
        const typeLabel = isFunPost ? "Fun post" : "Flight log · " + spotLabel(post);
        const dateLabel = isFunPost ? "Community post" : formatDate(post.flight_date);
        const description = post.description ? " · " + escapeHtml(post.description.slice(0, 90)) : "";
        return '<div class="admin-list-row">' +
          '<div class="admin-list-copy"><strong>' + escapeHtml(post.username) + ' · ' +
          escapeHtml(typeLabel) + '</strong><small>' + escapeHtml(dateLabel) +
          ' · ' + escapeHtml(formatTimestamp(post.created_at)) + description + '</small></div>' +
          '<div class="admin-list-actions"><button class="button button-quiet danger-button" type="button" data-admin-delete-post="' +
          escapeHtml(post.id) + '">Delete</button></div></div>';
      }).join("")
    : '<p class="muted">There are no community posts to manage.</p>';

  const users = Array.isArray(data.users) ? data.users : [];
  $("#admin-user-count").textContent = String(users.length);
  $("#admin-users-list").innerHTML = users.length
    ? users.map(function (user) {
        const isOwner = user.role === "owner";
        const isAdmin = user.role === "admin";
        const mayKick = !isOwner && (!isAdmin || currentUser.groupRole === "owner") && user.id !== currentUser.id;
        const action = mayKick
          ? '<div class="admin-list-actions"><button class="button button-quiet danger-button" type="button" data-admin-user-action="kick" data-admin-user-id="' +
            escapeHtml(user.id) + '" data-admin-user-name="' + escapeHtml(user.username) + '">Kick</button></div>'
          : '<span class="admin-protected-label">' + (isOwner ? "Group owner" : "Administrator") + '</span>';
        const status = isOwner ? "Group owner" : (isAdmin ? "Administrator" : "Member");
        return '<div class="admin-list-row"><div class="admin-list-copy"><strong>' +
          escapeHtml(user.username) + '</strong><small>' + escapeHtml(status) + ' · ' +
          escapeHtml(String(user.postCount)) + ' posts · Joined ' +
          escapeHtml(formatDate((user.createdAt || "").slice(0, 10))) +
          '</small></div>' + action + '</div>';
      }).join("")
    : '<p class="muted">There are no members in this group.</p>';
}

async function loadAdminPanel() {
  if (!currentUser) return;
  showMessage($("#admin-message"), "Checking administrator access…", false);
  try {
    // Refresh the session identity from the Worker before loading protected data.
    const session = await api("/api/me");
    if (!session.user) {
      showSignedOut();
      showMessage($("#auth-message"), "Your session expired. Please sign in again.", false);
      return;
    }

    currentUser = session.user;
    $("#account-name").textContent = currentUser.username;
    renderDashboardGreeting(currentUser.username);
    $("#admin-tab").hidden = !currentUser.isAdmin;

    if (!currentUser.isAdmin) {
      $("#admin-view").hidden = true;
      switchView("feed");
      showMessage(
        $("#feed-message"),
        "Your account does not have administrator access in this group.",
        false
      );
      return;
    }

    const data = await api("/api/admin/overview");
    renderAdminOverview(data);
    showMessage($("#admin-message"), "", false);
  } catch (error) {
    const message = error && error.message ? error.message : "The administrator dashboard could not be loaded.";
    showMessage($("#admin-message"), message, false);
    if (message.toLowerCase().includes("administrator") && message.toLowerCase().includes("username")) {
      try {
        const session = await api("/api/me");
        if (session.user) {
          currentUser = session.user;
          $("#admin-tab").hidden = !currentUser.isAdmin;
        }
      } catch (_sessionError) {}
    }
  }
}



function renderGroupPanel(group) {
  currentGroup = group;
  $("#app-section").hidden = false;
  $("#dashboard-group-name").textContent = group.name;
  $("#group-heading").textContent = group.name;
  $("#group-subtitle").textContent = group.isOwner
    ? "You're the owner of this group. Invite friends and manage its settings."
    : (group.canManage ? "You're a group administrator. You can help manage the crew." : "Your group home, invite code, and flight crew.");
  $("#group-role-badge").textContent = group.isOwner ? "Owner" : (group.role === "admin" ? "Administrator" : "Member");
  $("#group-invite-code").textContent = group.inviteCode;
  $("#group-member-count").textContent = group.memberCount + (group.memberCount === 1 ? " participant" : " participants");
  $("#group-member-limit").textContent = "Limit: " + group.maxMembers;
  $("#group-owner-settings").hidden = !group.isOwner;
  $("#group-regenerate-code").hidden = !group.isOwner;
  $("#group-leave-button").hidden = group.isOwner;
  $("#group-owner-transfer-note").hidden = !group.isOwner;
  $("#group-settings-name").value = group.name;
  $("#group-settings-limit").value = group.maxMembers;

  const members = Array.isArray(group.members) ? group.members : [];
  $("#group-members-count").textContent = String(members.length);
  $("#group-members-list").innerHTML = members.map(function (member) {
    const isSelf = member.id === currentUser.id;
    const roleLabel = member.role === "owner" ? "Owner" : (member.role === "admin" ? "Administrator" : "Member");
    let adminActions = "";
    if (!isSelf && group.isOwner && member.role !== "owner") {
      const nextRole = member.role === "admin" ? "member" : "admin";
      const roleText = member.role === "admin" ? "Remove admin" : "Make admin";
      adminActions = '<div class="group-member-admin-actions">' +
        '<button class="button button-quiet button-small" type="button" data-group-role="' + nextRole +
        '" data-group-user-id="' + escapeHtml(member.id) + '" data-group-user-name="' + escapeHtml(member.username) + '">' +
        roleText + '</button>' +
        '<button class="button button-quiet button-small" type="button" data-group-transfer-owner="' + escapeHtml(member.id) +
        '" data-group-user-name="' + escapeHtml(member.username) + '">Transfer owner</button>' +
        '<button class="button button-quiet button-small danger-button" type="button" data-group-kick="' + escapeHtml(member.id) +
        '" data-group-user-name="' + escapeHtml(member.username) + '">Remove</button></div>';
    } else if (!isSelf && group.canManage && member.role === "member") {
      adminActions = '<div class="group-member-admin-actions"><button class="button button-quiet button-small danger-button" type="button" data-group-kick="' +
        escapeHtml(member.id) + '" data-group-user-name="' + escapeHtml(member.username) + '">Remove</button></div>';
    }
    return '<article class="group-member-card">' +
      '<div class="group-member-identity">' +
        avatarMarkup(member.avatarBase64 || "", member.username, "group-member-avatar") +
        '<div class="group-member-copy"><strong>' + escapeHtml(member.username) + '</strong>' +
          '<span class="group-member-role" data-role="' + escapeHtml(member.role) + '">' + escapeHtml(roleLabel) + '</span></div>' +
      '</div>' +
      '<button class="button button-primary group-member-hangar" type="button" data-group-view-hangar="' +
        escapeHtml(member.id) + '" data-group-view-hangar-name="' + escapeHtml(member.username) + '">View Hangar</button>' +
      adminActions +
    '</article>';
  }).join("");

  const banned = Array.isArray(group.bannedUsers) ? group.bannedUsers : [];
  $("#group-bans-panel").hidden = !group.isOwner || !banned.length;
  $("#group-bans-list").innerHTML = banned.map(function (person) {
    return '<div class="admin-list-row"><div class="admin-list-copy"><strong>' +
      escapeHtml(person.username) + '</strong><small>Removed ' + escapeHtml(formatTimestamp(person.bannedAt)) +
      '</small></div><div class="admin-list-actions"><button class="button button-quiet" type="button" data-group-unban="' +
      escapeHtml(person.id) + '" data-group-user-name="' + escapeHtml(person.username) + '">Restore</button></div></div>';
  }).join("");
}

async function loadGroupPanel() {
  if (!currentUser || !currentUser.groupId) return;
  showMessage($("#group-message"), "", false);
  $("#group-members-list").innerHTML = '<p class="muted">Loading group members…</p>';
  try {
    const result = await api("/api/group");
    if (!result.group) {
      await checkSession();
      return;
    }
    renderGroupPanel(result.group);
  } catch (error) {
    if (currentUser && currentUser.groupId) {
      $("#app-section").hidden = false;
      $("#dashboard-group-name").textContent = currentGroup ? currentGroup.name : "Your group";
    }
    showMessage($("#group-message"), error.message, false);
  }
}

async function createOrJoinGroup(path, body, button, messageElement) {
  setBusy(button, true, path.endsWith("/create") ? "Creating…" : "Joining…");
  showMessage(messageElement, "", false);
  try {
    await api(path, { method: "POST", body: body });
    showMessage(messageElement, "Group ready.", true);
    await checkSession();
    switchView("group");
    toast(path.endsWith("/create") ? "Group created." : "Joined group.");
  } catch (error) {
    showMessage(messageElement, error.message, false);
  } finally {
    setBusy(button, false);
  }
}
function renderTopbarAvatar(base64, username) {
  $("#topbar-avatar").innerHTML = base64
    ? '<img src="data:image/jpeg;base64,' + escapeHtml(base64) + '" alt="">'
    : escapeHtml(username ? username.slice(0, 1).toUpperCase() : "?");
}

function openHangar(userId, username) {
  activeHangarUserId = userId || currentUser.id;
  activeHangarUsername = username || currentUser.username;
  switchView("hangar");
}

function resetHangarPhoto() {
  selectedHangarPhotoBase64 = "";
  $("#hangar-photo").value = "";
  $("#hangar-photo-preview").removeAttribute("src");
  $("#hangar-photo-preview-wrap").hidden = true;
}

function renderHangar(data) {
  activeHangarIsMine = Boolean(data.isMine);
  activeHangarUsername = data.owner.username;
  $("#hangar-title").textContent = activeHangarIsMine ? "My Hangar" : data.owner.username + "'s Hangar";
  $("#hangar-subtitle").textContent = activeHangarIsMine
    ? "Your aircraft collection. Add the RC planes you own."
    : "Aircraft listed by " + data.owner.username + ".";
  $("#hangar-add-panel").hidden = !activeHangarIsMine;
  $("#hangar-back-button").hidden = activeHangarIsMine;
  const planes = Array.isArray(data.planes) ? data.planes : [];
  if (!planes.length) {
    $("#hangar-list").innerHTML = '<div class="feed-empty"><strong>This Hangar is empty</strong>' +
      (activeHangarIsMine ? "Add an aircraft you own to get started." : "This participant has not listed any aircraft yet.") +
      '</div>';
    return;
  }
  $("#hangar-list").innerHTML = planes.map(function (plane) {
    const photo = plane.photo_base64
      ? '<div class="hangar-photo-wrap"><img src="data:image/jpeg;base64,' +
        escapeHtml(plane.photo_base64) + '" alt="' + escapeHtml(plane.name) + '" loading="lazy"></div>'
      : '<div class="hangar-photo-placeholder"><span>✈</span><small>No photo</small></div>';
    const description = plane.description
      ? '<p class="hangar-plane-description">' + escapeHtml(plane.description) + '</p>'
      : "";
    const remove = activeHangarIsMine
      ? '<button class="text-button" type="button" data-delete-hangar-plane="' + escapeHtml(plane.id) +
        '" data-delete-hangar-name="' + escapeHtml(plane.name) + '">Remove from Hangar</button>'
      : "";
    return '<article class="hangar-card">' + photo +
      '<div class="hangar-card-body"><h3>' + escapeHtml(plane.name) + '</h3>' +
      description + '<div class="hangar-card-footer">' + remove + '</div></div></article>';
  }).join("");
}

async function loadHangar() {
  if (!currentUser) return;
  if (!activeHangarUserId) {
    activeHangarUserId = currentUser.id;
    activeHangarUsername = currentUser.username;
  }
  $("#hangar-list").innerHTML = '<p class="muted">Loading Hangar…</p>';
  showMessage($("#hangar-message"), "", false);
  try {
    const result = await api("/api/hangar?userId=" + encodeURIComponent(activeHangarUserId));
    renderHangar(result);
  } catch (error) {
    $("#hangar-list").innerHTML = "";
    showMessage($("#hangar-message"), error.message, false);
  }
}

async function loadSettings() {
  showMessage($("#settings-message"), "", false);
  try {
    const result = await api("/api/settings");
    selectedAvatarBase64 = result.avatarBase64 || "";
    $("#settings-username").value = result.user.username;
    updateSettingsAvatarPreview();
    currentUser = result.user;
    currentUser.avatarBase64 = selectedAvatarBase64;
    $("#account-name").textContent = currentUser.username;
    renderTopbarAvatar(selectedAvatarBase64, currentUser.username);
    $("#admin-tab").hidden = !currentUser.isAdmin;
  } catch (error) {
    showMessage($("#settings-message"), error.message, false);
  }
}

function updateSettingsAvatarPreview() {
  $("#settings-avatar-preview").innerHTML = selectedAvatarBase64
    ? '<img src="data:image/jpeg;base64,' + escapeHtml(selectedAvatarBase64) + '" alt="">'
    : escapeHtml(currentUser && currentUser.username ? currentUser.username.slice(0, 1).toUpperCase() : "?");
}

async function handleHangarPhotoSelection(file) {
  if (!file) return;
  showMessage($("#hangar-photo-message"), "Preparing photo…", false);
  try {
    const result = await compressPhoto(file, 135000);
    selectedHangarPhotoBase64 = result.base64;
    $("#hangar-photo-preview").src = result.preview;
    $("#hangar-photo-caption").textContent = (file.name || "Aircraft photo") + " · " +
      Math.round(result.sizeBytes / 1024) + " KB";
    $("#hangar-photo-preview-wrap").hidden = false;
    showMessage($("#hangar-photo-message"), "Photo ready.", true);
  } catch (error) {
    resetHangarPhoto();
    showMessage($("#hangar-photo-message"), error.message, false);
  }
}

async function handleAvatarPhotoSelection(file) {
  if (!file) return;
  showMessage($("#settings-avatar-message"), "Preparing picture…", false);
  try {
    const result = await compressPhoto(file, 112000);
    selectedAvatarBase64 = result.base64;
    updateSettingsAvatarPreview();
    showMessage($("#settings-avatar-message"), "Profile picture ready.", true);
  } catch (error) {
    showMessage($("#settings-avatar-message"), error.message, false);
  }
}
function updatePlaneSuggestions(planes) {
  knownPlanes = Array.isArray(planes) ? planes : [];
  $("#plane-suggestions").innerHTML = knownPlanes
    .map(function (plane) { return '<option value="' + escapeHtml(plane) + '"></option>'; })
    .join("");
}

function startFeedPolling() {
  if (feedPollTimer) clearInterval(feedPollTimer);
  feedPollTimer = setInterval(function () {
    if (!$("#feed-view").hidden) checkForNewPosts();
  }, 20000);
}

function stopFeedPolling() {
  if (feedPollTimer) clearInterval(feedPollTimer);
  feedPollTimer = null;
}

async function checkForNewPosts() {
  if (feedState.loading || $("#feed-view").hidden) return;
  if (!feedState.posts.length) {
    await loadFeed(false);
    return;
  }
  let newest = feedState.posts[feedState.posts.length - 1];
  let after = { createdAt: newest.createdAt, id: newest.id };
  const incoming = [];
  let pages = 0;

  try {
    while (pages < 4) {
      const query = new URLSearchParams({
        afterCreatedAt: after.createdAt,
        afterId: after.id
      });
      const result = await api("/api/feed?" + query.toString());
      if (!result.posts.length) break;
      incoming.push.apply(incoming, result.posts);
      if (!result.hasMore || !result.nextCursor) break;
      after = result.nextCursor;
      pages += 1;
    }

    if (!incoming.length) return;
    const scroller = $("#feed-scroller");
    const wasNearBottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 140;
    feedState.posts = feedState.posts.concat(incoming);
    renderFeed();
    if (wasNearBottom) {
      scroller.scrollTop = scroller.scrollHeight;
      $("#new-posts-bar").hidden = true;
    } else {
      $("#new-posts-button").textContent = incoming.length === 1
        ? "1 new post below ↓"
        : incoming.length + " new posts below ↓";
      $("#new-posts-bar").hidden = false;
    }
  } catch (_error) {
    // Keep the current feed visible; the next poll will retry.
  }
}

function switchView(view) {
  if (view === "admin" && (!currentUser || !currentUser.isAdmin)) view = "feed";
  const isFeed = view === "feed";
  const isMine = view === "mine";
  const isLog = view === "log";
  const isFunPost = view === "fun-post";
  const isHangar = view === "hangar";
  const isSettings = view === "settings";
  const isGroup = view === "group";
  const isAdminView = view === "admin";
  $("#feed-view").hidden = !isFeed;
  $("#my-logs-view").hidden = !isMine;
  $("#log-view").hidden = !isLog;
  $("#fun-post-view").hidden = !isFunPost;
  $("#hangar-view").hidden = !isHangar;
  $("#settings-view").hidden = !isSettings;
  $("#group-view").hidden = !isGroup;
  $("#admin-view").hidden = !isAdminView;
  $("#feed-tab").classList.toggle("active", isFeed);
  $("#my-logs-tab").classList.toggle("active", isMine);
  $("#hangar-tab").classList.toggle("active", isHangar);
  $("#settings-tab").classList.toggle("active", isSettings);
  $("#group-tab").classList.toggle("active", isGroup);
  $("#admin-tab").classList.toggle("active", isAdminView);
  $("#feed-tab").toggleAttribute("aria-current", isFeed);
  $("#my-logs-tab").toggleAttribute("aria-current", isMine);
  $("#hangar-tab").toggleAttribute("aria-current", isHangar);
  $("#settings-tab").toggleAttribute("aria-current", isSettings);
  $("#group-tab").toggleAttribute("aria-current", isGroup);
  $("#admin-tab").toggleAttribute("aria-current", isAdminView);

  if (isFeed) {
    startFeedPolling();
    $("#new-posts-bar").hidden = true;
    if (!feedState.posts.length) loadFeed(false);
    else {
      requestAnimationFrame(function () {
        $("#feed-scroller").scrollTop = $("#feed-scroller").scrollHeight;
      });
      checkForNewPosts();
    }
  } else {
    stopFeedPolling();
  }
  if (isMine) loadMyLogs();
  if (view === "hangar") loadHangar();
  if (view === "settings") loadSettings();
  if (isGroup) loadGroupPanel();
  if (isAdminView) loadAdminPanel();
  if (isLog) {
    $("#post-flight-date").value = localDate();
    showMessage($("#post-message"), "", false);
    showMessage($("#photo-message"), "", false);
  }
  if (isFunPost) {
    showMessage($("#fun-post-message"), "", false);
    showMessage($("#fun-post-photo-message"), "", false);
  }
}

function renderSelectedPlanes() {
  const container = $("#selected-planes");
  if (!selectedPlanes.length) {
    container.innerHTML = '<span id="no-planes-message" class="no-planes-message">No planes added yet.</span>';
    return;
  }
  container.innerHTML = selectedPlanes.map(function (plane, index) {
    return '<span class="plane-pill">' + escapeHtml(plane) +
      '<button type="button" data-remove-plane="' + index + '" aria-label="Remove ' + escapeHtml(plane) + '">×</button></span>';
  }).join("");
}

function addPlane() {
  const input = $("#plane-input");
  const plane = input.value.trim();
  if (plane.length < 2 || plane.length > 60) {
    showMessage($("#post-message"), "Plane names must be 2–60 characters.", false);
    input.focus();
    return;
  }
  if (selectedPlanes.length >= 8) {
    showMessage($("#post-message"), "You can add up to eight planes to one post.", false);
    return;
  }
  if (selectedPlanes.some(function (item) { return item.toLowerCase() === plane.toLowerCase(); })) {
    showMessage($("#post-message"), "That plane is already selected.", false);
    input.value = "";
    return;
  }
  selectedPlanes.push(plane);
  input.value = "";
  renderSelectedPlanes();
  showMessage($("#post-message"), "", false);
}

function clearPhoto() {
  selectedPhotoBase64 = "";
  $("#post-photo").value = "";
  $("#photo-preview-wrap").hidden = true;
  $("#photo-drop").hidden = false;
  $("#photo-preview").removeAttribute("src");
  $("#photo-file-name").textContent = "";
}

function clearFunPhoto() {
  selectedFunPhotoBase64 = "";
  $("#fun-post-photo").value = "";
  $("#fun-post-photo-preview-wrap").hidden = true;
  $("#fun-post-photo-drop").hidden = false;
  $("#fun-post-photo-preview").removeAttribute("src");
  $("#fun-post-photo-file-name").textContent = "";
}

async function handleFunPhotoSelection(file) {
  if (!file) return;
  showMessage($("#fun-post-photo-message"), "Preparing photo…", false);
  try {
    const result = await compressPhoto(file, 315000);
    selectedFunPhotoBase64 = result.base64;
    $("#fun-post-photo-preview").src = result.preview;
    $("#fun-post-photo-file-name").textContent =
      (file.name || "Camera-roll photo") + " · " + Math.round(result.sizeBytes / 1024) + " KB";
    $("#fun-post-photo-preview-wrap").hidden = false;
    $("#fun-post-photo-drop").hidden = true;
    showMessage($("#fun-post-photo-message"), "Photo ready to upload.", true);
  } catch (error) {
    clearFunPhoto();
    showMessage($("#fun-post-photo-message"), error.message, false);
  }
}

async function decodeSelectedImage(file) {
  // Prefer createImageBitmap, which applies the image orientation metadata on
  // supported browsers. Safari's native image decoder also handles HEIC.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (_firstError) {
      try {
        return await createImageBitmap(file);
      } catch (_secondError) {
        // Fall through to an HTMLImageElement for older mobile browsers.
      }
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise(function (resolve, reject) {
      const image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () {
        reject(new Error("Your browser couldn't read this photo format. Try choosing a JPEG version from your camera roll."));
      };
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise(function (resolve, reject) {
    canvas.toBlob(function (blob) {
      if (blob) resolve(blob);
      else reject(new Error("Your browser couldn't convert this photo. Please try another image."));
    }, "image/jpeg", quality);
  });
}

function blobToBase64(blob) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("The photo could not be prepared for upload."));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = function () {
      reject(new Error("The photo could not be prepared for upload."));
    };
    reader.readAsDataURL(blob);
  });
}

async function compressPhoto(file, maximumBlobBytes) {
  if (!file) throw new Error("Choose a photo from your camera roll.");
  const maxBlobBytes = Number.isInteger(maximumBlobBytes) && maximumBlobBytes > 0
    ? maximumBlobBytes : 315000;
  // Some mobile pickers provide an empty or generic MIME type. Do not reject
  // the file based on MIME metadata; attempt to decode it instead.
  if (file.size > 25 * 1024 * 1024) {
    throw new Error("Please choose a photo smaller than 25 MB.");
  }
  if (file.size < 1) throw new Error("That photo appears to be empty.");

  let image;
  try {
    image = await decodeSelectedImage(file);
  } catch (_error) {
    const type = (file.type || "").toLowerCase();
    const extension = (file.name || "").toLowerCase();
    if (type.includes("heic") || type.includes("heif") ||
        extension.endsWith(".heic") || extension.endsWith(".heif")) {
      throw new Error("This browser couldn't open that HEIC photo. Try selecting the photo from your camera roll's Photo Library rather than Browse, or choose a JPEG copy.");
    }
    throw new Error("Your browser couldn't read this photo. Please choose a JPG, PNG, or WebP image from your camera roll.");
  }

  try {
    const originalWidth = image.width || image.naturalWidth;
    const originalHeight = image.height || image.naturalHeight;
    if (!originalWidth || !originalHeight) {
      throw new Error("The selected photo has no readable image dimensions.");
    }
    if (originalWidth * originalHeight > 50000000) {
      throw new Error("That photo has an unusually large resolution. Please choose a smaller camera-roll copy.");
    }

    const maxBase64Length = Math.floor(maxBlobBytes * 4 / 3);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Your browser could not prepare this photo.");

    // Try good quality first, then progressively reduce quality and dimensions
    // until the JPEG fits the D1 row and request limits.
    const maxDimensions = [1600, 1400, 1200, 1000, 850, 720, 600];
    const uniqueDimensions = Array.from(new Set(
      maxDimensions.map(function (maxSide) {
        return Math.min(maxSide, Math.max(originalWidth, originalHeight));
      })
    ));
    const qualities = [0.82, 0.72, 0.62, 0.52, 0.44];
    let lastSize = 0;

    for (const maxSide of uniqueDimensions) {
      const scale = Math.min(1, maxSide / Math.max(originalWidth, originalHeight));
      const width = Math.max(1, Math.round(originalWidth * scale));
      const height = Math.max(1, Math.round(originalHeight * scale));
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      for (const quality of qualities) {
        const blob = await canvasToJpegBlob(canvas, quality);
        lastSize = blob.size;
        if (blob.size > maxBlobBytes) continue;
        const base64 = await blobToBase64(blob);
        if (base64.length <= maxBase64Length) {
          return {
            base64: base64,
            preview: "data:image/jpeg;base64," + base64,
            sizeBytes: blob.size
          };
        }
      }
    }

    throw new Error(
      "This photo is still too large after resizing (" +
      Math.round(lastSize / 1024) + " KB). Please choose a smaller photo."
    );
  } finally {
    if (image && typeof image.close === "function") image.close();
  }
}

async function handlePhotoSelection(file) {
  if (!file) return;
  showMessage($("#photo-message"), "Preparing photo…", false);
  try {
    const result = await compressPhoto(file);
    selectedPhotoBase64 = result.base64;
    $("#photo-preview").src = result.preview;
    $("#photo-file-name").textContent =
      (file.name || "Camera-roll photo") + " · " + Math.round(result.sizeBytes / 1024) + " KB";
    $("#photo-preview-wrap").hidden = false;
    $("#photo-drop").hidden = true;
    showMessage($("#photo-message"), "Photo ready to upload.", true);
  } catch (error) {
    clearPhoto();
    showMessage($("#photo-message"), error.message, false);
  }
}

async function refreshMyStats() {
  try {
    const dashboard = await api("/api/dashboard");
    $("#stat-posts").textContent = String(dashboard.totalPosts);
    $("#stat-days").textContent = String(dashboard.flyingDays);
    $("#stat-planes").textContent = String(dashboard.uniquePlanes);
    updatePlaneSuggestions(dashboard.knownPlanes || []);
  } catch (_error) {
    // The view will show an error when its main feed request is made.
  }
}

async function checkSession() {
  try {
    const result = await api("/api/me");
    if (result.user) {
      const previousGroupId = currentUser ? currentUser.groupId : null;
      const nextGroupId = result.user.groupId || null;
      if (previousGroupId !== nextGroupId) {
        currentGroup = null;
        stopFeedPolling();
        feedState = { posts: [], hasMore: false, nextCursor: null, loading: false };
        activeHangarUserId = null;
        activeHangarUsername = "";
        activeHangarIsMine = true;
      }
      showSignedIn(result.user);
      if (!result.user.groupId) {
        showMessage($("#group-setup-message"), "Create a group or enter an invite code to join your friends.", false);
        return;
      }
      await Promise.all([
        loadSettings(),
        refreshMyStats(),
        loadGroupPanel()
      ]);
      switchView("feed");
    } else {
      showSignedOut();
    }
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
    const path = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    await api(path, {
      method: "POST",
      body: {
        username: $("#auth-username").value.trim(),
        password: $("#auth-password").value
      }
    });
    await checkSession();
  } catch (error) {
    showMessage(message, error.message, false);
  } finally {
    setBusy(button, false);
  }
});

$("#theme-toggle").addEventListener("click", function () {
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  applyTheme(current === "dark" ? "light" : "dark", true);
});

$("#logout-button").addEventListener("click", async function () {
  try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch (_error) {}
  feedState = { posts: [], hasMore: false, nextCursor: null, loading: false };
  clearPhoto();
  selectedPlanes = [];
  showSignedOut();
});


$("#admin-tab").addEventListener("click", function () { switchView("admin"); });

$("#admin-start-challenge-button").addEventListener("click", async function () {
  const startDate = $("#admin-challenge-start-date").value;
  if (!startDate) {
    showMessage($("#admin-challenge-message"), "Choose a start date first.", false);
    return;
  }
  const label = $("#admin-challenge-status").textContent === "Ended" ? "restart" : "start";
  if (!window.confirm("Are you sure you want to " + label + " the optional 360-day challenge window?")) return;
  const button = $("#admin-start-challenge-button");
  setBusy(button, true, "Saving…");
  showMessage($("#admin-challenge-message"), "", false);
  try {
    await api("/api/admin/challenge/start", { method: "POST", body: { startDate: startDate } });
    showMessage($("#admin-challenge-message"), "The 360-day window has been scheduled.", true);
    await loadAdminPanel();
    toast("Challenge window updated.");
  } catch (error) {
    showMessage($("#admin-challenge-message"), error.message, false);
  } finally {
    setBusy(button, false);
  }
});

$("#admin-end-challenge-button").addEventListener("click", async function () {
  if (!window.confirm("End the 360-day challenge window now? The group can still use the flight journal.")) return;
  const button = $("#admin-end-challenge-button");
  setBusy(button, true, "Ending…");
  showMessage($("#admin-challenge-message"), "", false);
  try {
    await api("/api/admin/challenge/end", { method: "POST", body: {} });
    showMessage($("#admin-challenge-message"), "The challenge window has ended.", true);
    await loadAdminPanel();
    toast("Challenge ended.");
  } catch (error) {
    showMessage($("#admin-challenge-message"), error.message, false);
  } finally {
    setBusy(button, false);
  }
});

$("#admin-posts-list").addEventListener("click", async function (event) {
  const button = event.target.closest("[data-admin-delete-post]");
  if (!button) return;
  const postId = button.getAttribute("data-admin-delete-post");
  if (!window.confirm("Delete this post and its stored photo? This cannot be undone.")) return;
  setBusy(button, true, "Deleting…");
  try {
    await api("/api/admin/posts/" + encodeURIComponent(postId), { method: "DELETE" });
    feedState.posts = feedState.posts.filter(function (post) { return post.id !== postId; });
    renderFeed();
    if (!$("#my-logs-view").hidden) await loadMyLogs();
    await loadAdminPanel();
    toast("Post deleted.");
  } catch (error) {
    showMessage($("#admin-message"), error.message, false);
    button.disabled = false;
    button.textContent = "Delete";
  }
});

$("#admin-users-list").addEventListener("click", async function (event) {
  const button = event.target.closest("[data-admin-user-action]");
  if (!button) return;
  const userId = button.getAttribute("data-admin-user-id");
  const username = button.getAttribute("data-admin-user-name");
  if (!window.confirm("Remove " + username + " from this group? Their account and personal Hangar remain, but they cannot rejoin with this invite code.")) return;
  setBusy(button, true, "Removing…");
  try {
    await api("/api/admin/users/" + encodeURIComponent(userId) + "/kick", { method: "POST" });
    await loadAdminPanel();
    await loadGroupPanel();
    toast(username + " was removed from the group.");
  } catch (error) {
    showMessage($("#admin-message"), error.message, false);
    button.disabled = false;
    button.textContent = "Kick";
  }
});



$("#group-setup-signout").addEventListener("click", async function () {
  try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch (_error) {}
  showSignedOut();
});

$("#group-create-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  await createOrJoinGroup("/api/groups/create", {
    name: $("#group-create-name").value.trim(),
    maxMembers: Number($("#group-create-limit").value)
  }, $("#group-create-button"), $("#group-create-message"));
});
$("#group-join-code").addEventListener("input", function () {
  const clean = this.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  this.value = clean.length > 4 ? clean.slice(0, 4) + "-" + clean.slice(4) : clean;
});
$("#group-join-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  await createOrJoinGroup("/api/groups/join", {
    code: $("#group-join-code").value.trim().toUpperCase()
  }, $("#group-join-button"), $("#group-join-message"));
  $("#group-join-code").value = "";
});

$("#group-tab").addEventListener("click", function () { switchView("group"); });
$("#group-settings-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  const button = $("#group-settings-save");
  setBusy(button, true, "Saving…");
  showMessage($("#group-settings-message"), "", false);
  try {
    await api("/api/group/settings", {
      method: "POST",
      body: {
        name: $("#group-settings-name").value.trim(),
        maxMembers: Number($("#group-settings-limit").value)
      }
    });
    await loadGroupPanel();
    toast("Group settings saved.");
  } catch (error) {
    showMessage($("#group-settings-message"), error.message, false);
  } finally {
    setBusy(button, false);
  }
});
$("#group-copy-code").addEventListener("click", async function () {
  try {
    await navigator.clipboard.writeText($("#group-invite-code").textContent);
    toast("Invite code copied.");
  } catch (_error) {
    showMessage($("#group-message"), "Copy isn't available here. You can select the invite code and copy it manually.", false);
  }
});
$("#group-regenerate-code").addEventListener("click", async function () {
  if (!window.confirm("Generate a new invite code? The old code will stop working.")) return;
  setBusy($("#group-regenerate-code"), true, "Generating…");
  try {
    await api("/api/group/invite-code", { method: "POST", body: {} });
    await loadGroupPanel();
    toast("New invite code generated.");
  } catch (error) {
    showMessage($("#group-message"), error.message, false);
  } finally {
    setBusy($("#group-regenerate-code"), false);
  }
});
$("#group-members-list").addEventListener("click", async function (event) {
  const button = event.target.closest("[data-group-view-hangar], [data-group-role], [data-group-transfer-owner], [data-group-kick]");
  if (!button || !currentGroup) return;
  if (button.hasAttribute("data-group-view-hangar")) {
    openHangar(button.getAttribute("data-group-view-hangar"), button.getAttribute("data-group-view-hangar-name"));
    return;
  }
  const userId = button.getAttribute("data-group-user-id") ||
      button.getAttribute("data-group-transfer-owner") || button.getAttribute("data-group-kick");
  const username = button.getAttribute("data-group-user-name") || "this participant";

  if (button.hasAttribute("data-group-role")) {
    const role = button.getAttribute("data-group-role");
    const message = role === "admin"
      ? "Give " + username + " administrator access to this group?"
      : "Remove administrator access from " + username + "?";
    if (!window.confirm(message)) return;
    setBusy(button, true, "Saving…");
    try {
      await api("/api/group/members/" + encodeURIComponent(userId) + "/role", {
        method: "POST", body: { role: role }
      });
      await loadGroupPanel();
      toast(role === "admin" ? username + " is now an administrator." : username + " is now a member.");
    } catch (error) {
      showMessage($("#group-message"), error.message, false);
      button.disabled = false;
    }
    return;
  }

  if (button.hasAttribute("data-group-transfer-owner")) {
    if (!window.confirm("Transfer group ownership to " + username + "? You will become an administrator, and they will become the owner.")) return;
    setBusy(button, true, "Transferring…");
    try {
      await api("/api/group/transfer", { method: "POST", body: { userId: userId } });
      await checkSession();
      switchView("group");
      toast("Group ownership transferred.");
    } catch (error) {
      showMessage($("#group-message"), error.message, false);
      button.disabled = false;
    }
    return;
  }

  if (button.hasAttribute("data-group-kick")) {
    if (!window.confirm("Remove " + username + " from this group? Their account and personal Hangar remain, but they cannot rejoin with this group's invite code.")) return;
    setBusy(button, true, "Removing…");
    try {
      await api("/api/group/members/" + encodeURIComponent(userId) + "/kick", { method: "POST", body: {} });
      await loadGroupPanel();
      await loadAdminPanelIfOpen();
      toast(username + " was removed from the group.");
    } catch (error) {
      showMessage($("#group-message"), error.message, false);
      button.disabled = false;
    }
  }
});
async function loadAdminPanelIfOpen() {
  if (!$("#admin-view").hidden) await loadAdminPanel();
}
$("#group-bans-list").addEventListener("click", async function (event) {
  const button = event.target.closest("[data-group-unban]");
  if (!button) return;
  const userId = button.getAttribute("data-group-unban");
  const username = button.getAttribute("data-group-user-name");
  if (!window.confirm("Remove the group restriction for " + username + "? They will need the current invite code to rejoin.")) return;
  setBusy(button, true, "Restoring…");
  try {
    await api("/api/group/bans/" + encodeURIComponent(userId) + "/restore", { method: "POST", body: {} });
    await loadGroupPanel();
    toast(username + " can join again with the current code.");
  } catch (error) {
    showMessage($("#group-message"), error.message, false);
    button.disabled = false;
  }
});
$("#group-leave-button").addEventListener("click", async function () {
  if (!window.confirm("Leave " + (currentGroup ? currentGroup.name : "this group") + "? Your flight posts and Hangar entries will remain with the group, but you will no longer be able to see them.")) return;
  setBusy($("#group-leave-button"), true, "Leaving…");
  try {
    await api("/api/group/leave", { method: "POST", body: {} });
    await checkSession();
    toast("You left the group.");
  } catch (error) {
    showMessage($("#group-message"), error.message, false);
    setBusy($("#group-leave-button"), false);
  }
});

$("#hangar-tab").addEventListener("click", function () {
  openHangar(currentUser.id, currentUser.username);
});
$("#settings-tab").addEventListener("click", function () { switchView("settings"); });
$("#hangar-back-button").addEventListener("click", function () { switchView("group"); });

$("#hangar-photo").addEventListener("change", function () {
  handleHangarPhotoSelection(this.files && this.files[0]);
});
$("#hangar-remove-photo-button").addEventListener("click", function () {
  resetHangarPhoto();
  showMessage($("#hangar-photo-message"), "Photo removed.", false);
});
$("#hangar-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#hangar-save-button");
  const name = $("#hangar-plane-name").value.trim();
  setBusy(button, true, "Adding…");
  showMessage($("#hangar-form-message"), "", false);
  try {
    await api("/api/hangar", {
      method: "POST",
      body: {
        name: name,
        description: $("#hangar-plane-description").value.trim(),
        photoBase64: selectedHangarPhotoBase64
      }
    });
    form.reset();
    resetHangarPhoto();
    showMessage($("#hangar-form-message"), "Aircraft added to your Hangar.", true);
    await loadHangar();
    toast("Aircraft added to your Hangar.");
  } catch (error) {
    showMessage($("#hangar-form-message"), error.message, false);
  } finally {
    setBusy(button, false);
  }
});
$("#hangar-list").addEventListener("click", async function (event) {
  const button = event.target.closest("[data-delete-hangar-plane]");
  if (!button || !activeHangarIsMine) return;
  const id = button.getAttribute("data-delete-hangar-plane");
  const name = button.getAttribute("data-delete-hangar-name");
  if (!window.confirm("Remove " + name + " from your Hangar?")) return;
  setBusy(button, true, "Removing…");
  try {
    await api("/api/hangar/" + encodeURIComponent(id), { method: "DELETE" });
    await loadHangar();
    toast("Aircraft removed from your Hangar.");
  } catch (error) {
    showMessage($("#hangar-message"), error.message, false);
    button.disabled = false;
    button.textContent = "Remove from Hangar";
  }
});

$("#settings-avatar-file").addEventListener("change", function () {
  handleAvatarPhotoSelection(this.files && this.files[0]);
});
$("#settings-avatar-remove").addEventListener("click", function () {
  selectedAvatarBase64 = "";
  $("#settings-avatar-file").value = "";
  updateSettingsAvatarPreview();
  showMessage($("#settings-avatar-message"), "Profile picture will be removed when you save.", false);
});
$("#settings-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  const button = $("#settings-save-button");
  setBusy(button, true, "Saving…");
  showMessage($("#settings-message"), "", false);
  try {
    const result = await api("/api/settings", {
      method: "POST",
      body: {
        username: $("#settings-username").value.trim(),
        avatarBase64: selectedAvatarBase64
      }
    });
    currentUser = result.user;
    currentUser.avatarBase64 = result.avatarBase64 || "";
    showSignedIn(currentUser);
    $("#settings-username").value = currentUser.username;
    selectedAvatarBase64 = currentUser.avatarBase64;
    updateSettingsAvatarPreview();
    showMessage($("#settings-message"), "Your profile has been updated.", true);
    if (!currentUser.isAdmin && !$("#admin-view").hidden) switchView("feed");
    toast("Settings saved.");
  } catch (error) {
    showMessage($("#settings-message"), error.message, false);
  } finally {
    setBusy(button, false);
  }
});

$("#feed-tab").addEventListener("click", function () { switchView("feed"); });
$("#my-logs-tab").addEventListener("click", function () { switchView("mine"); });
$("#log-flight-button").addEventListener("click", function () { switchView("log"); });
$("#log-flight-button-secondary").addEventListener("click", function () { switchView("log"); });
$("#back-to-feed-button").addEventListener("click", function () { switchView("feed"); });

$("#flying-spot").addEventListener("change", function () {
  const isOther = this.value === "other";
  $("#other-spot-field").hidden = !isOther;
  $("#other-spot").required = isOther;
  if (!isOther) $("#other-spot").value = "";
});

$("#add-plane-button").addEventListener("click", addPlane);
$("#plane-input").addEventListener("keydown", function (event) {
  if (event.key === "Enter") {
    event.preventDefault();
    addPlane();
  }
});

$("#selected-planes").addEventListener("click", function (event) {
  const button = event.target.closest("[data-remove-plane]");
  if (!button) return;
  const index = Number(button.getAttribute("data-remove-plane"));
  if (Number.isInteger(index) && index >= 0 && index < selectedPlanes.length) {
    selectedPlanes.splice(index, 1);
    renderSelectedPlanes();
  }
});

$("#post-photo").addEventListener("change", function () {
  handlePhotoSelection(this.files && this.files[0]);
});
$("#remove-photo-button").addEventListener("click", function () {
  clearPhoto();
  showMessage($("#photo-message"), "Photo removed. Choose another photo to continue.", false);
});

$("#post-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  // currentTarget is only reliable during the synchronous event dispatch.
  // Keep the form reference for use after the asynchronous API request.
  const form = event.currentTarget;
  const button = $("#publish-post-button");
  showMessage($("#post-message"), "", false);

  if (!selectedPlanes.length) {
    showMessage($("#post-message"), "Please add at least one plane.", false);
    $("#plane-input").focus();
    return;
  }
  if (!selectedPhotoBase64) {
    showMessage($("#post-message"), "Please upload a photo of your RC plane at the flying spot.", false);
    $("#post-photo").click();
    return;
  }

  setBusy(button, true, "Publishing...");
  try {
    await api("/api/posts", {
      method: "POST",
      body: {
        flightDate: $("#post-flight-date").value,
        spot: $("#flying-spot").value,
        otherSpot: $("#other-spot").value.trim(),
        planes: selectedPlanes.slice(),
        description: $("#post-description").value.trim(),
        photoMime: "image/jpeg",
        photoBase64: selectedPhotoBase64
      }
    });

    form.reset();
    selectedPlanes = [];
    renderSelectedPlanes();
    clearPhoto();
    $("#other-spot-field").hidden = true;
    $("#other-spot").required = false;
    $("#post-flight-date").value = localDate();
    await refreshMyStats();
    feedState = { posts: [], hasMore: false, nextCursor: null, loading: false };
    switchView("feed");
    toast("Your flight log has been posted.");
  } catch (error) {
    showMessage($("#post-message"), error.message, false);
  } finally {
    setBusy(button, false);
  }
});

$("#create-fun-post-button").addEventListener("click", function () { switchView("fun-post"); });
$("#back-to-feed-fun-button").addEventListener("click", function () { switchView("feed"); });
$("#fun-post-photo").addEventListener("change", function () {
  handleFunPhotoSelection(this.files && this.files[0]);
});
$("#fun-post-photo-remove-button").addEventListener("click", function () {
  clearFunPhoto();
  showMessage($("#fun-post-photo-message"), "Photo removed.", false);
});
$("#fun-post-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#publish-fun-post-button");
  const description = $("#fun-post-text").value.trim();
  showMessage($("#fun-post-message"), "", false);
  if (!description && !selectedFunPhotoBase64) {
    showMessage($("#fun-post-message"), "Add some text, a photo, or both before posting.", false);
    return;
  }

  setBusy(button, true, "Posting…");
  try {
    await api("/api/posts", {
      method: "POST",
      body: {
        postType: "fun",
        description: description,
        photoMime: selectedFunPhotoBase64 ? "image/jpeg" : "",
        photoBase64: selectedFunPhotoBase64
      }
    });
    form.reset();
    clearFunPhoto();
    feedState = { posts: [], hasMore: false, nextCursor: null, loading: false };
    switchView("feed");
    toast("Your fun post has been shared.");
  } catch (error) {
    showMessage($("#fun-post-message"), error.message, false);
  } finally {
    setBusy(button, false);
  }
});

$("#load-older-button").addEventListener("click", function () { loadFeed(true); });
$("#feed-scroller").addEventListener("scroll", function () {
  if (this.scrollTop < 100 && feedState.hasMore && !feedState.loading) {
    loadFeed(true);
  }
  if (this.scrollHeight - this.clientHeight - this.scrollTop < 80) {
    $("#new-posts-bar").hidden = true;
  }
});
$("#new-posts-button").addEventListener("click", function () {
  $("#feed-scroller").scrollTop = $("#feed-scroller").scrollHeight;
  $("#new-posts-bar").hidden = true;
});

initializeTheme();
$("#post-flight-date").value = localDate();
checkSession();
