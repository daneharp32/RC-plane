const SESSION_COOKIE = "rcplane_session";
const SESSION_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
// Cloudflare Workers Web Crypto currently rejects PBKDF2 iteration counts above 100,000.
const PASSWORD_ITERATIONS = 100000;
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
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64Url(new Uint8Array(digest));
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

function localToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = {};
  for (const part of parts) values[part.type] = part.value;
  return values.year + "-" + values.month + "-" + values.day;
}

async function readJson(request, maxLength) {
  const maximum = Number.isInteger(maxLength) ? maxLength : 16000;
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > maximum) throw new Error("Request is too large.");
  const text = await request.text();
  if (text.length > maximum) throw new Error("Request is too large.");
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

  // Use a regular D1 write followed by a read. This avoids relying on
  // INSERT ... RETURNING support in the authentication hot path.
  await db.prepare(
    "INSERT INTO rate_limits (id, request_count, reset_at) VALUES (?, 1, ?) " +
    "ON CONFLICT(id) DO UPDATE SET " +
    "request_count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.request_count + 1 END, " +
    "reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END"
  ).bind(key, resetAt, now, now).run();

  const row = await db.prepare(
    "SELECT request_count, reset_at FROM rate_limits WHERE id = ?"
  ).bind(key).first();

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
  const row = await db.prepare(
    "SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id " +
    "LEFT JOIN user_moderation m ON m.user_id = u.id " +
    "WHERE s.token_hash = ? AND s.expires_at > ? AND m.user_id IS NULL"
  ).bind(tokenHash, new Date().toISOString()).first();
  return row ? { id: row.id, username: row.username } : null;
}

async function requireUser(request, db) {
  const user = await getSession(request, db);
  if (!user) return { response: errorResponse("Please sign in to continue.", 401) };
  return { user: user };
}

function isAdminUser(_env, user) {
  return Boolean(user && typeof user.username === "string" &&
    user.username.toLowerCase().includes("dane"));
}

async function requireAdmin(request, env) {
  const auth = await requireUser(request, env.DB);
  if (auth.response) return auth;
  if (!isAdminUser(env, auth.user)) {
    return { response: errorResponse("Administrator permission is required.", 403) };
  }
  return auth;
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
    { user: { id: user.id, username: user.username } },
    200,
    { "Set-Cookie": cookieHeader(token, Math.floor(SESSION_DURATION_MS / 1000)) }
  );
}

async function handleRegister(request, env) {
  let stage = "rate-limit check";
  try {
    stage = "read registration details";
    const body = await readJson(request);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      return errorResponse("Usernames must be 3–20 characters and use only letters, numbers, or underscores.");
    }
    if (password.length < 6 || password.length > 128) {
      return errorResponse("Passwords must be at least 6 characters and no more than 128 characters.");
    }

    stage = "password hashing";
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const user = { id: randomId(), username: username };
    const passwordHash = await hashPassword(password, salt);

    stage = "save account";
    try {
      await env.DB.prepare(
        "INSERT INTO users (id, username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(user.id, user.username, base64Url(salt), passwordHash, new Date().toISOString()).run();
    } catch (error) {
      const message = error && error.message ? error.message : "";
      if (message.toLowerCase().includes("unique") || message.toLowerCase().includes("constraint")) {
        return errorResponse("That username is already taken. Please choose another.", 409);
      }
      throw error;
    }

    stage = "create login session";
    return await createSessionResponse(env.DB, user);
  } catch (error) {
    console.error("Registration failed during " + stage + ":", error && error.message ? error.message : "unknown error");
    return errorResponse("Registration failed during " + stage + ". Please try again. If it keeps happening, send this message to support.", 500);
  }
}
async function handleLogin(request, env) {
  const limit = await consumeRateLimit(
    env.DB,
    await requestRateKey(request, "login"),
    20,
    15 * 60 * 1000
  );
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
    "SELECT u.id, u.username, u.password_salt, u.password_hash, " +
    "CASE WHEN m.user_id IS NULL THEN 0 ELSE 1 END AS is_suspended " +
    "FROM users u LEFT JOIN user_moderation m ON m.user_id = u.id " +
    "WHERE u.username = ? COLLATE NOCASE"
  ).bind(username).first();
  const salt = row ? fromBase64Url(row.password_salt) : new Uint8Array(16);
  const passwordHash = await hashPassword(password, salt);
  if (!row || !constantTimeEqual(passwordHash, row.password_hash)) {
    return errorResponse("Username or password is incorrect.", 401);
  }
  if (row.is_suspended) {
    return errorResponse("This account has been suspended by an administrator.", 403);
  }
  return createSessionResponse(env.DB, { id: row.id, username: row.username });
}

async function handleLogout(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sha256(token)).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": clearCookieHeader() });
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
  const results = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) AS total, COUNT(DISTINCT flight_date) AS flying_days " +
      "FROM flight_posts WHERE user_id = ?"
    ).bind(user.id).first(),
    env.DB.prepare(
      "SELECT planes_json FROM flight_posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 500"
    ).bind(user.id).all()
  ]);

  const totals = results[0] || { total: 0, flying_days: 0 };
  const planeNames = new Map();
  for (const row of results[1].results || []) {
    try {
      const planes = JSON.parse(row.planes_json);
      if (Array.isArray(planes)) {
        for (const plane of planes) {
          if (typeof plane === "string" && plane.trim()) {
            const name = plane.trim();
            planeNames.set(name.toLowerCase(), name);
          }
        }
      }
    } catch (_error) {
      // Skip malformed legacy plane lists; the post itself remains readable.
    }
  }
  const knownPlanes = Array.from(planeNames.values()).sort(function (a, b) {
    return a.localeCompare(b);
  });

  return json({
    user: { id: user.id, username: user.username },
    totalPosts: totals.total || 0,
    flyingDays: totals.flying_days || 0,
    uniquePlanes: knownPlanes.length,
    knownPlanes: knownPlanes
  });
}
async function handleCreateFlight(request, env, user) {
  const body = await readJson(request);
  const flightDate = typeof body.flightDate === "string" ? body.flightDate : "";
  const aircraft = typeof body.aircraft === "string" ? body.aircraft.trim() : "";
  const duration = Number(body.durationMinutes);
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (!isValidDate(flightDate)) return errorResponse("Please enter a valid flight date.");
  if (flightDate > localToday()) return errorResponse("A flight date cannot be in the future.");
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


let flightPostsSchemaReady = false;

async function ensureFlightPostsSchema(db) {
  if (flightPostsSchemaReady) return;
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS flight_posts (" +
    "id TEXT PRIMARY KEY, " +
    "user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, " +
    "flight_date TEXT NOT NULL, " +
    "spot TEXT NOT NULL CHECK (spot IN ('chill_guy','unc_road','sports_park','shore_cliffs','other')), " +
    "other_spot TEXT NOT NULL DEFAULT '', " +
    "planes_json TEXT NOT NULL, " +
    "description TEXT NOT NULL DEFAULT '', " +
    "photo_mime TEXT NOT NULL DEFAULT 'image/jpeg' CHECK (photo_mime = 'image/jpeg'), " +
    "photo_base64 TEXT NOT NULL CHECK (length(photo_base64) <= 440000), " +
    "created_at TEXT NOT NULL)"
  ).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_flight_posts_created ON flight_posts(created_at DESC, id DESC)"
  ).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_flight_posts_user_created ON flight_posts(user_id, created_at DESC, id DESC)"
  ).run();
  flightPostsSchemaReady = true;
}

let adminSchemaReady = false;

async function ensureAdminSchema(db) {
  if (adminSchemaReady) return;
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS user_moderation (" +
    "user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, " +
    "reason TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)"
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS challenge_settings (" +
    "id INTEGER PRIMARY KEY CHECK(id = 1), " +
    "status TEXT NOT NULL CHECK(status IN ('not_started','active','ended')), " +
    "start_date TEXT, end_date TEXT, ended_at TEXT, updated_at TEXT NOT NULL, " +
    "updated_by TEXT REFERENCES users(id))"
  ).run();
  await db.prepare(
    "INSERT OR IGNORE INTO challenge_settings (id, status, updated_at) VALUES (1, 'not_started', ?)"
  ).bind(new Date().toISOString()).run();
  adminSchemaReady = true;
}

let profileHangarSchemaReady = false;

async function ensureProfileHangarSchema(db) {
  if (profileHangarSchemaReady) return;
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS user_profiles (" +
    "user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, " +
    "avatar_base64 TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)"
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS hangar_planes (" +
    "id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, " +
    "name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', " +
    "photo_base64 TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_hangar_user_created ON hangar_planes(user_id, created_at DESC)"
  ).run();
  profileHangarSchemaReady = true;
}

function validBase64Image(value, maxLength, optional) {
  if (typeof value !== "string") return false;
  if (optional && value === "") return true;
  return value.length >= 100 && value.length <= maxLength &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

async function handleGetSettings(env, user) {
  const row = await env.DB.prepare(
    "SELECT avatar_base64 FROM user_profiles WHERE user_id = ?"
  ).bind(user.id).first();
  return json({
    user: { id: user.id, username: user.username, isAdmin: isAdminUser(env, user) },
    avatarBase64: row && row.avatar_base64 ? row.avatar_base64 : ""
  });
}

async function handleUpdateSettings(request, env, user) {
  const body = await readJson(request, 220000);
  const newUsername = typeof body.username === "string" ? body.username.trim() : user.username;
  const hasAvatar = Object.prototype.hasOwnProperty.call(body, "avatarBase64");
  const avatarBase64 = hasAvatar ? body.avatarBase64 : null;

  if (!/^[A-Za-z0-9_]{3,20}$/.test(newUsername)) {
    return errorResponse("Usernames must be 3–20 characters and use only letters, numbers, or underscores.");
  }
  if (hasAvatar && !validBase64Image(avatarBase64, 150000, true)) {
    return errorResponse("Please choose a smaller profile picture (maximum about 110 KB after compression).");
  }

  if (newUsername.toLowerCase() !== user.username.toLowerCase()) {
    try {
      await env.DB.prepare("UPDATE users SET username = ? WHERE id = ?")
        .bind(newUsername, user.id).run();
    } catch (error) {
      const message = error && error.message ? error.message.toLowerCase() : "";
      if (message.includes("unique") || message.includes("constraint")) {
        return errorResponse("That username is already taken. Please choose another.", 409);
      }
      throw error;
    }
  }

  if (hasAvatar) {
    await env.DB.prepare(
      "INSERT INTO user_profiles (user_id, avatar_base64, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET avatar_base64 = excluded.avatar_base64, updated_at = excluded.updated_at"
    ).bind(user.id, avatarBase64, new Date().toISOString()).run();
  } else {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO user_profiles (user_id, avatar_base64, updated_at) VALUES (?, '', ?)"
    ).bind(user.id, new Date().toISOString()).run();
  }

  return await handleGetSettings(env, { id: user.id, username: newUsername });
}

async function handleParticipants(env) {
  const result = await env.DB.prepare(
    "SELECT u.id, u.username, up.avatar_base64, " +
    "(SELECT COUNT(DISTINCT CAST((julianday(p.flight_date) - julianday(cs.start_date)) / 7 AS INTEGER)) " +
    "FROM flight_posts p WHERE p.user_id = u.id AND cs.start_date IS NOT NULL " +
    "AND p.flight_date >= cs.start_date AND (cs.end_date IS NULL OR p.flight_date <= cs.end_date)) AS weeks_completed " +
    "FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id " +
    "LEFT JOIN challenge_settings cs ON cs.id = 1 " +
    "LEFT JOIN user_moderation m ON m.user_id = u.id " +
    "WHERE m.user_id IS NULL ORDER BY u.username COLLATE NOCASE"
  ).all();

  const participants = result.results || [];
  const hangarRows = await env.DB.prepare(
    "SELECT h.user_id, h.name FROM hangar_planes h " +
    "JOIN users u ON u.id = h.user_id " +
    "LEFT JOIN user_moderation m ON m.user_id = u.id " +
    "WHERE m.user_id IS NULL ORDER BY h.name COLLATE NOCASE"
  ).all();
  const planeMap = new Map();
  for (const row of hangarRows.results || []) {
    if (!planeMap.has(row.user_id)) planeMap.set(row.user_id, []);
    planeMap.get(row.user_id).push(row.name);
  }

  return json({
    participants: participants.map(function (row) {
      return {
        id: row.id,
        username: row.username,
        avatarBase64: row.avatar_base64 || "",
        weeksCompleted: row.weeks_completed || 0,
        planes: planeMap.get(row.id) || []
      };
    })
  });
}

async function handleGetHangar(env, user, targetUserId) {
  const targetId = targetUserId || user.id;
  const target = await env.DB.prepare(
    "SELECT u.id, u.username, up.avatar_base64 FROM users u " +
    "LEFT JOIN user_profiles up ON up.user_id = u.id " +
    "LEFT JOIN user_moderation m ON m.user_id = u.id " +
    "WHERE u.id = ? AND m.user_id IS NULL"
  ).bind(targetId).first();
  if (!target) return errorResponse("That participant could not be found.", 404);
  const result = await env.DB.prepare(
    "SELECT id, name, description, photo_base64, created_at, updated_at " +
    "FROM hangar_planes WHERE user_id = ? ORDER BY created_at DESC"
  ).bind(targetId).all();
  return json({
    owner: { id: target.id, username: target.username, avatarBase64: target.avatar_base64 || "" },
    isMine: target.id === user.id,
    planes: result.results || []
  });
}

async function handleCreateHangarPlane(request, env, user) {
  const body = await readJson(request, 210000);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const photoBase64 = typeof body.photoBase64 === "string" ? body.photoBase64 : "";
  if (name.length < 2 || name.length > 60) {
    return errorResponse("Plane names must be between 2 and 60 characters.");
  }
  if (description.length > 300) return errorResponse("Plane details must be 300 characters or fewer.");
  if (!validBase64Image(photoBase64, 180000, true)) {
    return errorResponse("Please choose a smaller aircraft photo (maximum about 130 KB after compression).");
  }
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM hangar_planes WHERE user_id = ?"
  ).bind(user.id).first();
  if (count && count.total >= 30) return errorResponse("Your Hangar can hold up to 30 aircraft entries.", 409);

  const duplicate = await env.DB.prepare(
    "SELECT id FROM hangar_planes WHERE user_id = ? AND name = ? COLLATE NOCASE"
  ).bind(user.id, name).first();
  if (duplicate) return errorResponse("That aircraft is already in your Hangar.", 409);

  const id = randomId();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO hangar_planes (id, user_id, name, description, photo_base64, created_at, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, user.id, name, description, photoBase64, now, now).run();
  return json({ ok: true, id: id }, 201);
}

async function handleDeleteHangarPlane(env, user, planeId) {
  const result = await env.DB.prepare(
    "DELETE FROM hangar_planes WHERE id = ? AND user_id = ?"
  ).bind(planeId, user.id).run();
  if (!result.meta || result.meta.changes < 1) return errorResponse("Aircraft not found in your Hangar.", 404);
  return json({ ok: true });
}

function challengePublicState(row) {
  const today = localToday();
  let status = row ? row.status : "not_started";
  if (status === "active" && row.end_date && row.end_date < today) status = "ended";
  else if (status === "active" && row.start_date && row.start_date > today) status = "scheduled";
  return {
    status: status,
    startDate: row && row.start_date ? row.start_date : null,
    endDate: row && row.end_date ? row.end_date : null,
    endedAt: row && row.ended_at ? row.ended_at : null
  };
}

async function readChallengeState(db) {
  const row = await db.prepare(
    "SELECT status, start_date, end_date, ended_at FROM challenge_settings WHERE id = 1"
  ).first();
  return challengePublicState(row);
}

async function handleChallengeStatus(env) {
  return json({ challenge: await readChallengeState(env.DB) });
}

async function handleAdminOverview(env) {
  const [challenge, posts, users] = await Promise.all([
    readChallengeState(env.DB),
    env.DB.prepare(
      "SELECT p.id, p.flight_date, p.spot, p.other_spot AS otherSpot, p.description, p.created_at, u.username " +
      "FROM flight_posts p JOIN users u ON u.id = p.user_id " +
      "ORDER BY p.created_at DESC, p.id DESC"
    ).all(),
    env.DB.prepare(
      "SELECT u.id, u.username, u.created_at, " +
      "CASE WHEN m.user_id IS NULL THEN 0 ELSE 1 END AS is_suspended, " +
      "(SELECT COUNT(*) FROM flight_posts p WHERE p.user_id = u.id) AS post_count " +
      "FROM users u LEFT JOIN user_moderation m ON m.user_id = u.id " +
      "ORDER BY u.created_at ASC"
    ).all()
  ]);

  return json({
    challenge: challenge,
    posts: posts.results || [],
    users: (users.results || []).map(function (row) {
      return {
        id: row.id,
        username: row.username,
        createdAt: row.created_at,
        isSuspended: Boolean(row.is_suspended),
        postCount: row.post_count || 0,
        isAdmin: isAdminUser(env, { username: row.username })
      };
    })
  });
}

async function handleAdminDeletePost(env, postId) {
  const result = await env.DB.prepare("DELETE FROM flight_posts WHERE id = ?").bind(postId).run();
  if (!result.meta || result.meta.changes < 1) return errorResponse("Post not found.", 404);
  return json({ ok: true });
}

async function handleAdminUserStatus(env, admin, targetUserId, suspend) {
  const target = await env.DB.prepare(
    "SELECT id, username FROM users WHERE id = ?"
  ).bind(targetUserId).first();
  if (!target) return errorResponse("User not found.", 404);
  if (target.id === admin.id || isAdminUser(env, target)) {
    return errorResponse("An administrator account cannot be kicked or suspended.", 400);
  }

  if (suspend) {
    await env.DB.prepare(
      "INSERT INTO user_moderation (user_id, reason, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason, updated_at = excluded.updated_at"
    ).bind(target.id, "Suspended by administrator", new Date().toISOString()).run();
    // Existing cookies are also blocked by getSession; delete their sessions immediately as well.
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id).run();
  } else {
    await env.DB.prepare("DELETE FROM user_moderation WHERE user_id = ?").bind(target.id).run();
  }
  return json({ ok: true, isSuspended: suspend });
}

async function handleAdminStartChallenge(request, env, admin) {
  const body = await readJson(request);
  const startDate = typeof body.startDate === "string" ? body.startDate : "";
  if (!isValidDate(startDate) || startDate < localToday()) {
    return errorResponse("Choose today or a future date for the challenge start.");
  }

  const current = await readChallengeState(env.DB);
  if (current.status === "active" || current.status === "scheduled") {
    return errorResponse("The 360-day challenge is already underway.", 409);
  }

  const end = new Date(startDate + "T00:00:00.000Z");
  end.setUTCDate(end.getUTCDate() + 359);
  const endDate = end.toISOString().slice(0, 10);
  await env.DB.prepare(
    "UPDATE challenge_settings SET status = 'active', start_date = ?, end_date = ?, ended_at = NULL, " +
    "updated_at = ?, updated_by = ? WHERE id = 1"
  ).bind(startDate, endDate, new Date().toISOString(), admin.id).run();
  return json({ ok: true, challenge: await readChallengeState(env.DB) });
}

async function handleAdminEndChallenge(env, admin) {
  const current = await readChallengeState(env.DB);
  if (current.status !== "active" && current.status !== "scheduled") {
    return errorResponse("There is no active challenge to end.", 409);
  }
  await env.DB.prepare(
    "UPDATE challenge_settings SET status = 'ended', ended_at = ?, updated_at = ?, updated_by = ? WHERE id = 1"
  ).bind(localToday(), new Date().toISOString(), admin.id).run();
  return json({ ok: true, challenge: await readChallengeState(env.DB) });
}

function publicPost(row) {
  let planes = [];
  try {
    const parsed = JSON.parse(row.planes_json);
    if (Array.isArray(parsed)) planes = parsed.slice(0, 8);
  } catch (_error) {
    planes = [];
  }
  return {
    id: row.id,
    username: row.username,
    flightDate: row.flight_date,
    spot: row.spot,
    otherSpot: row.other_spot,
    planes: planes,
    description: row.description,
    photoMime: row.photo_mime,
    photoBase64: row.photo_base64,
    createdAt: row.created_at
  };
}

async function handleCreatePost(request, env, user) {
  const body = await readJson(request, 560000);
  const flightDate = typeof body.flightDate === "string" ? body.flightDate : "";
  const spot = typeof body.spot === "string" ? body.spot : "";
  const otherSpot = typeof body.otherSpot === "string" ? body.otherSpot.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const planes = Array.isArray(body.planes) ? body.planes : [];
  const photoMime = typeof body.photoMime === "string" ? body.photoMime : "";
  const photoBase64 = typeof body.photoBase64 === "string" ? body.photoBase64 : "";

  const allowedSpots = ["chill_guy", "unc_road", "sports_park", "shore_cliffs", "other"];
  if (!isValidDate(flightDate)) return errorResponse("Please choose a valid flight date.");
  if (flightDate > localToday()) return errorResponse("A flight date cannot be in the future.");
  if (!allowedSpots.includes(spot)) return errorResponse("Please choose a flying spot.");
  if (spot === "other" && (otherSpot.length < 2 || otherSpot.length > 120)) {
    return errorResponse("Please describe the flying spot in 2–120 characters.");
  }
  if (spot !== "other" && otherSpot) return errorResponse("Unexpected custom flying spot.");
  if (!planes.length || planes.length > 8) return errorResponse("Add at least one plane (up to eight).");

  const cleanPlanes = [];
  for (const value of planes) {
    if (typeof value !== "string") return errorResponse("Plane names must be text.");
    const name = value.trim();
    if (name.length < 2 || name.length > 60) return errorResponse("Plane names must be 2–60 characters.");
    if (!cleanPlanes.some(function (existing) { return existing.toLowerCase() === name.toLowerCase(); })) {
      cleanPlanes.push(name);
    }
  }
  if (!cleanPlanes.length) return errorResponse("Add at least one plane.");
  if (description.length > 1000) return errorResponse("Description must be 1,000 characters or fewer.");
  if (photoMime !== "image/jpeg") return errorResponse("Please upload a photo. Images are converted to JPEG before upload.");
  if (photoBase64.length < 100 || photoBase64.length > 440000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(photoBase64)) {
    return errorResponse("Please upload a smaller, valid photo (maximum 320 KB after compression).");
  }

  const id = randomId();
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO flight_posts " +
    "(id, user_id, flight_date, spot, other_spot, planes_json, description, photo_mime, photo_base64, created_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    id,
    user.id,
    flightDate,
    spot,
    otherSpot,
    JSON.stringify(cleanPlanes),
    description,
    photoMime,
    photoBase64,
    createdAt
  ).run();

  return json({ ok: true, id: id, createdAt: createdAt }, 201);
}

async function handleFeed(request, env, user) {
  const url = new URL(request.url);
  const mineOnly = url.searchParams.get("mine") === "1";
  const limit = mineOnly ? 40 : 12;
  const beforeCreatedAt = url.searchParams.get("beforeCreatedAt");
  const beforeId = url.searchParams.get("beforeId");
  const afterCreatedAt = url.searchParams.get("afterCreatedAt");
  const afterId = url.searchParams.get("afterId");
  const isNewerQuery = Boolean(afterCreatedAt && afterId &&
    !Number.isNaN(Date.parse(afterCreatedAt)) &&
    /^[A-Za-z0-9_-]{10,40}$/.test(afterId));

  let sql =
    "SELECT p.id, p.flight_date, p.spot, p.other_spot, p.planes_json, " +
    "p.description, p.photo_mime, p.photo_base64, p.created_at, u.username " +
    "FROM flight_posts p JOIN users u ON u.id = p.user_id WHERE 1 = 1";
  const bindings = [];
  if (mineOnly) {
    sql += " AND p.user_id = ?";
    bindings.push(user.id);
  }
  if (isNewerQuery) {
    sql += " AND (p.created_at > ? OR (p.created_at = ? AND p.id > ?))";
    bindings.push(afterCreatedAt, afterCreatedAt, afterId);
  } else if (beforeCreatedAt && beforeId &&
      !Number.isNaN(Date.parse(beforeCreatedAt)) &&
      /^[A-Za-z0-9_-]{10,40}$/.test(beforeId)) {
    sql += " AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))";
    bindings.push(beforeCreatedAt, beforeCreatedAt, beforeId);
  }
  const pageSize = isNewerQuery ? 30 : limit;
  sql += isNewerQuery
    ? " ORDER BY p.created_at ASC, p.id ASC LIMIT ?"
    : " ORDER BY p.created_at DESC, p.id DESC LIMIT ?";
  bindings.push(pageSize + 1);

  let statement = env.DB.prepare(sql);
  if (bindings.length) statement = statement.bind.apply(statement, bindings);
  const result = await statement.all();
  const rows = result.results || [];
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize);
  const cursorRow = page.length ? page[page.length - 1] : null;

  return json({
    posts: page.map(publicPost),
    hasMore: hasMore,
    nextCursor: hasMore && cursorRow ? {
      createdAt: cursorRow.created_at,
      id: cursorRow.id
    } : null
  });
}

async function routeApi(request, env) {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  if (!env.DB) {
    return errorResponse("The D1 database is not connected yet. Follow the setup steps in the repository README.", 503);
  }

  // Provision the social feed and admin tables automatically for existing D1 databases.
  await ensureFlightPostsSchema(env.DB);
  await ensureAdminSchema(env.DB);
  await ensureProfileHangarSchema(env.DB);

  if (method === "GET" && path === "/api/health") {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
      const requiredTables = ["users", "sessions", "flights", "rate_limits", "flight_posts", "user_moderation", "challenge_settings"];
      const tableRows = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
      ).all();
      const present = new Set((tableRows.results || []).map(function (row) { return row.name; }));
      const missing = requiredTables.filter(function (name) { return !present.has(name); });
      if (missing.length) {
        return json({ ok: false, database: "connected", schema: "incomplete", missingTables: missing }, 503);
      }
      // Exercise the same simple read/write pattern used by registration rate limits.
      const probeKey = "health-check:" + randomId();
      const now = Date.now();
      await env.DB.prepare(
        "INSERT INTO rate_limits (id, request_count, reset_at) VALUES (?, 1, ?)"
      ).bind(probeKey, now + 60000).run();
      const probe = await env.DB.prepare(
        "SELECT request_count FROM rate_limits WHERE id = ?"
      ).bind(probeKey).first();
      await env.DB.prepare("DELETE FROM rate_limits WHERE id = ?").bind(probeKey).run();
      if (!probe || probe.request_count !== 1) {
        return json({ ok: false, database: "connected", schema: "ready", rateLimitCheck: "failed" }, 503);
      }
      return json({ ok: true, database: "connected", schema: "ready", rateLimitCheck: "passed" });
    } catch (error) {
      console.error("Health check failed:", error && error.message ? error.message : "unknown error");
      return json({ ok: false, database: "error", message: "A database check failed. Check Worker logs." }, 503);
    }
  }

  const isMutation = method === "POST" || method === "DELETE";
  if (isMutation) {
    const origin = request.headers.get("Origin");
    if (!origin || new URL(origin).origin !== new URL(request.url).origin) {
      return errorResponse("Request origin could not be verified.", 403);
    }
  }

  if (method === "POST" && path === "/api/auth/register") return handleRegister(request, env);
  if (method === "POST" && path === "/api/auth/login") return handleLogin(request, env);
  if (method === "POST" && path === "/api/auth/logout") return handleLogout(request, env);

  if (method === "GET" && path === "/api/me") {
    const user = await getSession(request, env.DB);
    return json({
      user: user ? { id: user.id, username: user.username, isAdmin: isAdminUser(env, user) } : null
    });
  }

  if (method === "GET" && path === "/api/settings") {
    const auth = await requireUser(request, env.DB);
    if (auth.response) return auth.response;
    return handleGetSettings(env, auth.user);
  }

  if (method === "POST" && path === "/api/settings") {
    const auth = await requireUser(request, env.DB);
    if (auth.response) return auth.response;
    return handleUpdateSettings(request, env, auth.user);
  }

  if (method === "GET" && path === "/api/participants") {
    const auth = await requireUser(request, env.DB);
    if (auth.response) return auth.response;
    return handleParticipants(env);
  }

  if (method === "GET" && path === "/api/hangar") {
    const auth = await requireUser(request, env.DB);
    if (auth.response) return auth.response;
    const targetUserId = new URL(request.url).searchParams.get("userId") || auth.user.id;
    if (!/^[A-Za-z0-9_-]{10,40}$/.test(targetUserId)) return errorResponse("Invalid participant ID.");
    return handleGetHangar(env, auth.user, targetUserId);
  }

  if (method === "POST" && path === "/api/hangar") {
    const auth = await requireUser(request, env.DB);
    if (auth.response) return auth.response;
    return handleCreateHangarPlane(request, env, auth.user);
  }

  if (method === "DELETE" && path.indexOf("/api/hangar/") === 0) {
    const auth = await requireUser(request, env.DB);
    if (auth.response) return auth.response;
    const planeId = path.slice("/api/hangar/".length);
    if (!/^[A-Za-z0-9_-]{10,40}$/.test(planeId)) return errorResponse("Invalid aircraft ID.");
    return handleDeleteHangarPlane(env, auth.user, planeId);
  }

  if (method === "GET" && path === "/api/challenge") {
    const auth = await requireUser(request, env.DB);
    if (auth.response) return auth.response;
    return handleChallengeStatus(env);
  }

  if (method === "GET" && path === "/api/admin/overview") {
    const auth = await requireAdmin(request, env);
    if (auth.response) return auth.response;
    return handleAdminOverview(env);
  }

  if (method === "POST" && path === "/api/admin/challenge/start") {
    const auth = await requireAdmin(request, env);
    if (auth.response) return auth.response;
    return handleAdminStartChallenge(request, env, auth.user);
  }

  if (method === "POST" && path === "/api/admin/challenge/end") {
    const auth = await requireAdmin(request, env);
    if (auth.response) return auth.response;
    return handleAdminEndChallenge(env, auth.user);
  }

  if (method === "DELETE" && path.indexOf("/api/admin/posts/") === 0) {
    const auth = await requireAdmin(request, env);
    if (auth.response) return auth.response;
    const postId = path.slice("/api/admin/posts/".length);
    if (!/^[A-Za-z0-9_-]{10,40}$/.test(postId)) return errorResponse("Invalid post ID.");
    return handleAdminDeletePost(env, postId);
  }

  const adminUserMatch = path.match(/^\/api\/admin\/users\/([A-Za-z0-9_-]{10,40})\/(suspend|restore)$/);
  if (method === "POST" && adminUserMatch) {
    const auth = await requireAdmin(request, env);
    if (auth.response) return auth.response;
    return handleAdminUserStatus(env, auth.user, adminUserMatch[1], adminUserMatch[2] === "suspend");
  }

  if (method === "GET" && path === "/api/feed") {
    const auth = await requireUser(request, env.DB);
    if (auth.response) return auth.response;
    return handleFeed(request, env, auth.user);
  }

  if (method === "POST" && path === "/api/posts") {
    const auth = await requireUser(request, env.DB);
    if (auth.response) return auth.response;
    return handleCreatePost(request, env, auth.user);
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
