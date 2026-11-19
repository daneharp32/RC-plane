const SESSION_COOKIE = "rcplane_session";
const SESSION_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 600000;
const encoder = new TextEncoder();

function json(data, status, extraHeaders) {
  const headers = new Headers(extraHeaders || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status: status || 200, headers: headers });
}

function errorResponse(message, status, extraHeaders) {
  return json({ error: message }, status || 400, extraHeaders);
}

function base64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256(value) {
  const result = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64Url(new Uint8Array(result));
}

async function hashPassword(password, saltBytes) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: PASSWORD_ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return base64Url(new Uint8Array(derived));
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    difference |= (left.charCodeAt(i % Math.max(1, left.length)) || 0) ^
      (right.charCodeAt(i % Math.max(1, right.length)) || 0);
  }
  return difference === 0;
}

function randomId() {
  return base64Url(crypto.getRandomValues(new Uint8Array(18)));
}

function randomToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function getCookie(request, name) {
  const parts = (request.headers.get("Cookie") || "").split(";");
  for (const part of parts) {
    const splitAt = part.indexOf("=");
    if (splitAt >= 0 && part.slice(0, splitAt).trim() === name) {
      return part.slice(splitAt + 1).trim();
    }
  }
  return null;
}

function cookieHeader(token, maxAge) {
  return SESSION_COOKIE + "=" + token +
    "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + String(maxAge);
}

function clearCookieHeader() {
  return SESSION_COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(dateString, days) {
  const date = new Date(dateString + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayInTimezone(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const values = {};
    for (const part of parts) values[part.type] = part.value;
    return values.year + "-" + values.month + "-" + values.day;
  } catch (_error) {
    return new Date().toISOString().slice(0, 10);
  }
}

function validateTimezone(value) {
  if (typeof value !== "string" || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch (_error) {
    return false;
  }
}

function summarizeChallenge(settings, flights, today) {
  const startDate = settings ? settings.start_date : null;
  const timeZone = settings && settings.timezone ? settings.timezone : "UTC";
  const active = Boolean(settings && settings.is_active && startDate && isValidDate(startDate));
  const weeks = [];

  if (!active) {
    for (let i = 0; i < 52; i += 1) {
      const start = startDate && isValidDate(startDate) ? addDays(startDate, i * 7) : null;
      weeks.push({
        number: i + 1,
        startDate: start,
        endDate: start ? addDays(start, 6) : null,
        status: "upcoming"
      });
    }
    return {
      isConfigured: Boolean(startDate),
      isActive: false,
      startDate: startDate,
      timezone: timeZone,
      completedWeeks: 0,
      missedWeeks: 0,
      streak: 0,
      currentWeek: null,
      progressPercent: 0,
      weeks: weeks
    };
  }

  const endDate = addDays(startDate, 363);
  for (let i = 0; i < 52; i += 1) {
    const weekStart = addDays(startDate, i * 7);
    const weekEnd = addDays(weekStart, 6);
    const complete = flights.some(function (flight) {
      return flight.flight_date >= weekStart && flight.flight_date <= weekEnd;
    });
    let status = "upcoming";
    if (complete) status = "completed";
    else if (today > weekEnd) status = "missed";
    else if (today >= weekStart && today <= weekEnd) status = "current";
    weeks.push({ number: i + 1, startDate: weekStart, endDate: weekEnd, status: status });
  }

  let currentWeek = null;
  for (let i = 0; i < weeks.length; i += 1) {
    if (today >= weeks[i].startDate && today <= weeks[i].endDate) {
      currentWeek = i + 1;
      break;
    }
  }

  const completedWeeks = weeks.filter(function (week) {
    return week.status === "completed";
  }).length;
  const missedWeeks = weeks.filter(function (week) {
    return week.status === "missed";
  }).length;

  let anchor = currentWeek === null ? (today > endDate ? 51 : -1) : currentWeek - 1;
  if (anchor >= 0 && weeks[anchor].status !== "completed") anchor -= 1;
  let streak = 0;
  while (anchor >= 0 && weeks[anchor].status === "completed") {
    streak += 1;
    anchor -= 1;
  }

  return {
    isConfigured: true,
    isActive: true,
    startDate: startDate,
    endDate: endDate,
    timezone: timeZone,
    completedWeeks: completedWeeks,
    missedWeeks: missedWeeks,
    streak: streak,
    currentWeek: currentWeek,
    progressPercent: Math.round((completedWeeks / 52) * 100),
    weeks: weeks
  };
}

async function readJson(request) {
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > 16000) throw new Error("Request is too large.");
  const text = await request.text();
  if (text.length > 16000) throw new Error("Request is too large.");
  try {
    return JSON.parse(text || "{}");
  } catch (_error) {
    throw new Error("Please send valid JSON.");
  }
}

function validateOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch (_error) {
    return false;
  }
}

async function consumeRateLimit(db, key, maxRequests, windowMs) {
  const now = Date.now();
  const resetAt = now + windowMs;
  const row = await db.prepare(
    "INSERT INTO rate_limits (id, request_count, reset_at) VALUES (?, 1, ?) " +
    "ON CONFLICT(id) DO UPDATE SET " +
    "request_count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.request_count + 1 END, " +
    "reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END " +
    "RETURNING request_count, reset_at"
  ).bind(key, resetAt, now, now).first();

  return {
    allowed: Boolean(row && row.request_count <= maxRequests),
    retryAfter: row ? Math.max(1, Math.ceil((row.reset_at - now) / 1000)) : 60
  };
}

async function requestRateKey(request, prefix) {
  const ip = request.headers.get("CF-Connecting-IP") || "local-development";
  return prefix + ":" + await sha256(ip);
}

async function getSession(request, db) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || token.length < 30 || token.length > 100) return null;
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await db.prepare(
    "SELECT u.id, u.username, u.role, s.token_hash " +
    "FROM sessions s JOIN users u ON u.id = s.user_id " +
    "WHERE s.token_hash = ? AND s.expires_at > ?"
  ).bind(tokenHash, now).first();
  if (!row) return null;
  return { id: row.id, username: row.username, role: row.role, tokenHash: tokenHash };
}

async function requireUser(request, db) {
  const user = await getSession(request, db);
  if (!user) return { response: errorResponse("Please sign in to continue.", 401) };
  return { user: user };
}

async function requireAdmin(request, db) {
  const result = await requireUser(request, db);
  if (result.response) return result;
  if (result.user.role !== "admin") {
    return { response: errorResponse("Administrator access is required.", 403) };
  }
  return result;
}

async function createSessionResponse(db, user) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS).toISOString();
  await db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).bind(tokenHash, user.id, expiresAt, now.toISOString()).run();
  return json(
    { user: { id: user.id, username: user.username, role: user.role } },
    200,
    { "Set-Cookie": cookieHeader(token, Math.floor(SESSION_DURATION_MS / 1000)) }
  );
}

async function handleRegister(request, env) {
  const rateKey = await requestRateKey(request, "register");
  const limit = await consumeRateLimit(env.DB, rateKey, 5, 60 * 60 * 1000);
  if (!limit.allowed) {
    return errorResponse("Too many registration attempts. Please try again later.", 429, {
      "Retry-After": String(limit.retryAfter)
    });
  }

  const body = await readJson(request);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return errorResponse("Usernames must be 3–20 characters and use only letters, numbers, or underscores.");
  }
  if (password.length < 10 || password.length > 128) {
    return errorResponse("Passwords must be at least 10 characters and no more than 128 characters.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const user = { id: randomId(), username: username, role: "participant" };
  const passwordHash = await hashPassword(password, salt);
  try {
    await env.DB.prepare(
      "INSERT INTO users (id, username, password_salt, password_hash, role, created_at) " +
      "VALUES (?, ?, ?, ?, 'participant', ?)"
    ).bind(user.id, user.username, base64Url(salt), passwordHash, new Date().toISOString()).run();
  } catch (_error) {
    return errorResponse("That username is already taken. Please choose another.", 409);
  }
  return createSessionResponse(env.DB, user);
}

async function handleLogin(request, env) {
  const rateKey = await requestRateKey(request, "login");
  const limit = await consumeRateLimit(env.DB, rateKey, 20, 15 * 60 * 1000);
  if (!limit.allowed) {
    return errorResponse("Too many sign-in attempts. Please try again later.", 429, {
      "Retry-After": String(limit.retryAfter)
    });
  }

  const body = await readJson(request);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password || password.length > 128) {
    return errorResponse("Username or password is incorrect.", 401);
  }

  const row = await env.DB.prepare(
    "SELECT id, username, password_salt, password_hash, role FROM users WHERE username = ? COLLATE NOCASE"
  ).bind(username).first();

  const salt = row ? fromBase64Url(row.password_salt) : new Uint8Array(16);
  const actualHash = await hashPassword(password, salt);
  if (!row || !constantTimeEqual(actualHash, row.password_hash)) {
    return errorResponse("Username or password is incorrect.", 401);
  }

  return createSessionResponse(env.DB, { id: row.id, username: row.username, role: row.role });
}

async function handleLogout(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    const tokenHash = await sha256(token);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": clearCookieHeader() });
}

async function getChallengeSettings(db) {
  return db.prepare(
    "SELECT title, start_date, timezone, is_active, updated_at FROM challenge_settings WHERE id = 1"
  ).first();
}

function publicSettings(row) {
  if (!row) {
    return {
      title: "52-Week RC Flight Challenge",
      startDate: null,
      timezone: "America/Los_Angeles",
      isActive: false
    };
  }
  return {
    title: row.title,
    startDate: row.start_date,
    timezone: row.timezone,
    isActive: Boolean(row.is_active)
  };
}

function publicFlight(row) {
  return {
    id: row.id,
    flightDate: row.flight_date,
    aircraft: row.aircraft,
    durationMinutes: row.duration_minutes,
    notes: row.notes,
    createdAt: row.created_at
  };
}

async function handleDashboard(env, user) {
  const settingsRow = await getChallengeSettings(env.DB);
  const settings = publicSettings(settingsRow);
  const challengeFlightsQuery = settings.startDate
    ? env.DB.prepare(
      "SELECT flight_date FROM flights WHERE user_id = ? AND flight_date >= ? AND flight_date <= ?"
    ).bind(user.id, settings.startDate, addDays(settings.startDate, 363)).all()
    : Promise.resolve({ results: [] });

  const results = await Promise.all([
    env.DB.prepare(
      "SELECT id, flight_date, aircraft, duration_minutes, notes, created_at " +
      "FROM flights WHERE user_id = ? ORDER BY flight_date DESC, created_at DESC LIMIT 30"
    ).bind(user.id).all(),
    env.DB.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(duration_minutes), 0) AS minutes FROM flights WHERE user_id = ?")
      .bind(user.id).first(),
    challengeFlightsQuery
  ]);

  const recentFlights = results[0].results || [];
  const totals = results[1] || { total: 0, minutes: 0 };
  const today = todayInTimezone(settings.timezone);
  const summary = summarizeChallenge(settings, results[2].results || [], today);

  return json({
    user: { id: user.id, username: user.username, role: user.role },
    challenge: { settings: settings, summary: summary },
    flights: recentFlights.map(publicFlight),
    totalFlights: totals.total || 0,
    totalMinutes: totals.minutes || 0
  });
}

async function handleCreateFlight(request, env, user) {
  const body = await readJson(request);
  const flightDate = typeof body.flightDate === "string" ? body.flightDate : "";
  const aircraft = typeof body.aircraft === "string" ? body.aircraft.trim() : "";
  const duration = Number(body.durationMinutes);
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  if (!isValidDate(flightDate)) return errorResponse("Please enter a valid flight date.");
  const settings = publicSettings(await getChallengeSettings(env.DB));
  if (flightDate > todayInTimezone(settings.timezone)) {
    return errorResponse("A flight date cannot be in the future.");
  }
  if (aircraft.length < 2 || aircraft.length > 60) {
    return errorResponse("Aircraft name must be between 2 and 60 characters.");
  }
  if (!Number.isInteger(duration) || duration < 1 || duration > 720) {
    return errorResponse("Flight duration must be between 1 and 720 minutes.");
  }
  if (notes.length > 500) return errorResponse("Notes must be 500 characters or fewer.");

  const id = randomId();
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO flights (id, user_id, flight_date, aircraft, duration_minutes, notes, created_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, user.id, flightDate, aircraft, duration, notes, createdAt).run();

  return json({
    flight: {
      id: id,
      flightDate: flightDate,
      aircraft: aircraft,
      durationMinutes: duration,
      notes: notes,
      createdAt: createdAt
    }
  }, 201);
}

async function handleDeleteFlight(env, user, flightId) {
  const result = await env.DB.prepare(
    "DELETE FROM flights WHERE id = ? AND user_id = ?"
  ).bind(flightId, user.id).run();
  if (!result.meta || result.meta.changes < 1) return errorResponse("Flight not found.", 404);
  return json({ ok: true });
}

async function handleLeaderboard(env) {
  const [settingsRow, usersResult, flightsResult] = await Promise.all([
    getChallengeSettings(env.DB),
    env.DB.prepare("SELECT id, username FROM users").all(),
    env.DB.prepare("SELECT user_id, flight_date, duration_minutes FROM flights").all()
  ]);
  const settings = publicSettings(settingsRow);
  const allFlights = flightsResult.results || [];
  const today = todayInTimezone(settings.timezone);
  const entries = (usersResult.results || []).map(function (user) {
    const flights = allFlights.filter(function (flight) { return flight.user_id === user.id; });
    const summary = summarizeChallenge(settings, flights, today);
    return {
      username: user.username,
      completedWeeks: summary.completedWeeks,
      missedWeeks: summary.missedWeeks,
      streak: summary.streak,
      flightCount: flights.length,
      totalMinutes: flights.reduce(function (sum, flight) { return sum + flight.duration_minutes; }, 0)
    };
  });
  entries.sort(function (a, b) {
    return b.completedWeeks - a.completedWeeks ||
      b.streak - a.streak ||
      b.flightCount - a.flightCount ||
      a.username.localeCompare(b.username);
  });
  return json({ challenge: settings, participants: entries.length, leaderboard: entries.slice(0, 50) });
}

async function handleAdminOverview(env) {
  const [settingsRow, usersResult, flightsResult] = await Promise.all([
    getChallengeSettings(env.DB),
    env.DB.prepare("SELECT id, username, role, created_at FROM users ORDER BY created_at ASC").all(),
    env.DB.prepare("SELECT user_id, flight_date, duration_minutes FROM flights").all()
  ]);
  const settings = publicSettings(settingsRow);
  const allFlights = flightsResult.results || [];
  const today = todayInTimezone(settings.timezone);
  const participants = (usersResult.results || []).map(function (user) {
    const flights = allFlights.filter(function (flight) { return flight.user_id === user.id; });
    const summary = summarizeChallenge(settings, flights, today);
    return {
      username: user.username,
      role: user.role,
      createdAt: user.created_at,
      flightCount: flights.length,
      completedWeeks: summary.completedWeeks,
      missedWeeks: summary.missedWeeks,
      streak: summary.streak
    };
  });
  return json({
    settings: settings,
    participantCount: participants.filter(function (person) { return person.role === "participant"; }).length,
    totalFlights: allFlights.length,
    participants: participants
  });
}

async function handleSaveChallenge(request, env) {
  const body = await readJson(request);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const startDate = body.startDate === null || body.startDate === "" ? null : body.startDate;
  const timezone = typeof body.timezone === "string" ? body.timezone : "";
  const isActive = Boolean(body.isActive);

  if (title.length < 3 || title.length > 80) return errorResponse("Challenge title must be between 3 and 80 characters.");
  if (startDate !== null && !isValidDate(startDate)) return errorResponse("Please choose a valid challenge start date.");
  if (!validateTimezone(timezone)) return errorResponse("Please enter a valid time zone, such as America/Los_Angeles.");
  if (isActive && !startDate) return errorResponse("Choose a start date before activating the challenge.");

  await env.DB.prepare(
    "INSERT INTO challenge_settings (id, title, start_date, timezone, is_active, updated_at) " +
    "VALUES (1, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET title = excluded.title, start_date = excluded.start_date, " +
    "timezone = excluded.timezone, is_active = excluded.is_active, updated_at = excluded.updated_at"
  ).bind(title, startDate, timezone, isActive ? 1 : 0, new Date().toISOString()).run();
  return json({ settings: publicSettings(await getChallengeSettings(env.DB)) });
}

async function routeApi(request, env) {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();

  if (!env.DB) {
    return errorResponse("The D1 database is not connected yet. Follow the setup steps in the repository README.", 503);
  }

  if (method === "GET" && path === "/api/health") {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
      return json({ ok: true, database: "connected" });
    } catch (_error) {
      return errorResponse("The database is configured but its tables are not ready. Apply the migration.", 503);
    }
  }

  const isMutation = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
  if (isMutation && !validateOrigin(request)) return errorResponse("Request origin could not be verified.", 403);

  if (method === "POST" && path === "/api/auth/register") return handleRegister(request, env);
  if (method === "POST" && path === "/api/auth/login") return handleLogin(request, env);
  if (method === "POST" && path === "/api/auth/logout") return handleLogout(request, env);

  if (method === "GET" && path === "/api/me") {
    const user = await getSession(request, env.DB);
    return json({ user: user ? { id: user.id, username: user.username, role: user.role } : null });
  }

  if (method === "GET" && path === "/api/dashboard") {
    const auth = await requireUser(request, env.DB);
    if (auth.response) return auth.response;
    return handleDashboard(env, auth.user);
  }

  if (method === "POST" && path === "/api/flights") {
    const auth = await requireUser(request, env.DB);
    if (auth.response) return auth.response;
    return handleCreateFlight(request, env, auth.user);
  }

  if (method === "DELETE" && path.indexOf("/api/flights/") === 0) {
    const auth = await requireUser(request, env.DB);
    if (auth.response) return auth.response;
    const flightId = path.slice("/api/flights/".length);
    if (!/^[A-Za-z0-9_-]{10,40}$/.test(flightId)) return errorResponse("Invalid flight ID.");
    return handleDeleteFlight(env, auth.user, flightId);
  }

  if (method === "GET" && path === "/api/leaderboard") return handleLeaderboard(env);

  if (method === "GET" && path === "/api/admin/overview") {
    const auth = await requireAdmin(request, env.DB);
    if (auth.response) return auth.response;
    return handleAdminOverview(env);
  }

  if (method === "POST" && path === "/api/admin/challenge") {
    const auth = await requireAdmin(request, env.DB);
    if (auth.response) return auth.response;
    return handleSaveChallenge(request, env);
  }

  return errorResponse("API route not found.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return new Response("Not found.", { status: 404 });
    try {
      return await routeApi(request, env);
    } catch (error) {
      console.error("Request failed:", error && error.message ? error.message : "unknown error");
      if (error && error.message === "Request is too large.") return errorResponse(error.message, 413);
      if (error && error.message === "Please send valid JSON.") return errorResponse(error.message, 400);
      return errorResponse("Something went wrong. Please try again.", 500);
    }
  }
};
