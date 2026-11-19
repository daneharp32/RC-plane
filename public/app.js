const $ = function (selector) { return document.querySelector(selector); };

let authMode = "login";
let currentUser = null;
let selectedPlanes = [];
let knownPlanes = [];
let selectedPhotoBase64 = "";
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
  $("#auth-section").hidden = false;
  $("#app-section").hidden = true;
  $("#account-area").hidden = true;
  $("#auth-form").reset();
  setAuthMode("login");
}

function showSignedIn(user) {
  currentUser = user;
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

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit"
  }).format(date);
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

function renderPost(post) {
  const photoSrc = "data:image/jpeg;base64," + post.photoBase64;
  const planes = Array.isArray(post.planes) ? post.planes : [];
  const initial = post.username ? post.username.slice(0, 1).toUpperCase() : "?";
  const description = post.description
    ? '<p class="post-description">' + escapeHtml(post.description) + "</p>"
    : "";
  return '<article class="post-card" data-post-id="' + escapeHtml(post.id) + '">' +
    '<header class="post-header">' +
      '<div class="post-author">' +
        '<span class="avatar" aria-hidden="true">' + escapeHtml(initial) + "</span>" +
        '<div class="post-author-copy"><strong>' + escapeHtml(post.username) + '</strong>' +
        '<small>Flight date: ' + escapeHtml(formatDate(post.flightDate)) + "</small></div>" +
      "</div>" +
      '<time class="post-time" datetime="' + escapeHtml(post.createdAt) + '">' +
        escapeHtml(formatTimestamp(post.createdAt)) + "</time>" +
    "</header>" +
    '<div class="post-photo-wrap"><img class="post-photo" src="' + photoSrc +
      '" alt="RC plane at ' + escapeHtml(spotLabel(post)) + '" loading="lazy"></div>' +
    '<div class="post-body">' +
      '<div class="post-meta"><span class="post-chip spot">⌖ ' + escapeHtml(spotLabel(post)) +
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
    list.innerHTML = '<div class="feed-empty"><strong>No flight posts yet</strong>Be the first to share a photo from a completed flying session.</div>';
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
  const isFeed = view === "feed";
  const isMine = view === "mine";
  const isLog = view === "log";
  $("#feed-view").hidden = !isFeed;
  $("#my-logs-view").hidden = !isMine;
  $("#log-view").hidden = !isLog;
  $("#feed-tab").classList.toggle("active", isFeed);
  $("#my-logs-tab").classList.toggle("active", isMine);
  $("#feed-tab").toggleAttribute("aria-current", isFeed);
  $("#my-logs-tab").toggleAttribute("aria-current", isMine);

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
  if (isLog) {
    $("#post-flight-date").value = localDate();
    showMessage($("#post-message"), "", false);
    showMessage($("#photo-message"), "", false);
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

async function compressPhoto(file) {
  if (!file) throw new Error("Choose a photo from your camera roll.");
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

    const maxBase64Length = 420000;
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
        if (blob.size > 315000) continue;
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
      showSignedIn(result.user);
      await refreshMyStats();
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

$("#logout-button").addEventListener("click", async function () {
  try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch (_error) {}
  feedState = { posts: [], hasMore: false, nextCursor: null, loading: false };
  clearPhoto();
  selectedPlanes = [];
  showSignedOut();
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

    event.currentTarget.reset();
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

$("#post-flight-date").value = localDate();
checkSession();
