import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Award,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  CloudUpload,
  Flag,
  LogOut,
  Mail,
  Plane,
  ShieldCheck,
  Trophy,
  UserRound,
  Users,
  X
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase.js";

const TOTAL_WEEKS = 52;
const MAX_PHOTO_SIZE = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function formatDate(value) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function shortName(value) {
  return value?.trim() || "Pilot";
}

function StatCard({ icon: Icon, label, value, tone, footnote }) {
  return (
    <article className={"stat-card " + (tone || "")}>
      <div className="stat-top">
        <span className="stat-icon"><Icon size={18} /></span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value">{value}</div>
      {footnote ? <div className="stat-footnote">{footnote}</div> : null}
    </article>
  );
}

function SetupNotice() {
  return (
    <main className="setup-screen">
      <div className="setup-card">
        <div className="brand-mark"><Plane size={24} /></div>
        <p className="eyebrow">FIELDLOG · RC FLIGHT CHALLENGE</p>
        <h1>One flight.<br />Every week.</h1>
        <p className="muted">
          The website code is in place, but it still needs a Supabase project
          connected before accounts, photo uploads, and the shared leaderboard
          can work.
        </p>
        <div className="setup-steps">
          <div><span>01</span><p>Create a Supabase project and run <code>supabase/schema.sql</code>.</p></div>
          <div><span>02</span><p>Copy <code>.env.example</code> to <code>.env</code> and add your project URL and public anon key.</p></div>
          <div><span>03</span><p>Follow the README to set the site URL and designate the challenge owner.</p></div>
        </div>
        <a className="text-link" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">
          Open Supabase <ArrowRight size={15} />
        </a>
      </div>
    </main>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState("join");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (mode === "join" && nickname.trim().length < 2) {
      setError("Choose a nickname with at least 2 characters.");
      return;
    }
    setBusy(true);
    try {
      const options = {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: mode === "join"
      };
      if (mode === "join") {
        options.data = { nickname: nickname.trim() };
      }
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options
      });
      if (authError) throw authError;
      setMessage("Check your email for your secure sign-in link. This page will update after you open it.");
    } catch (err) {
      setError(err.message || "Unable to send the sign-in email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="hero-panel">
        <div className="hero-content">
          <div className="brand-lockup">
            <div className="brand-mark"><Plane size={23} /></div>
            <span>FIELDLOG</span>
          </div>
          <p className="eyebrow">THE RC PILOT'S YEAR</p>
          <h1>Make time<br />for the <em>field.</em></h1>
          <p className="hero-copy">
            One RC flight every week. One photo to prove it. A full year of
            showing up, flying, and keeping each other motivated.
          </p>
          <div className="hero-points">
            <div><CheckCircle2 size={17} /><span>52 weekly photo check-ins</span></div>
            <div><Users size={17} /><span>A shared friends leaderboard</span></div>
            <div><CalendarDays size={17} /><span>A 360-day challenge, on your start date</span></div>
          </div>
          <div className="hero-flight-line"><span /><Plane size={18} /><span /></div>
          <p className="hero-footnote">THE CLOCK HAS NOT STARTED.</p>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-box">
          <div className="mobile-brand"><div className="brand-mark"><Plane size={20} /></div><b>FIELDLOG</b></div>
          <p className="eyebrow">YOUR FLIGHT LOG STARTS HERE</p>
          <h2>{mode === "join" ? "Join the challenge" : "Welcome back"}</h2>
          <p className="muted">
            {mode === "join"
              ? "Create your pilot profile. Your email stays private; only your nickname appears on the leaderboard."
              : "Sign in with the email address you used when you joined."}
          </p>
          <div className="auth-switch">
            <button className={mode === "join" ? "active" : ""} onClick={() => { setMode("join"); setError(""); setMessage(""); }}>Create account</button>
            <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); setMessage(""); }}>Sign in</button>
          </div>
          <form onSubmit={submit} className="auth-form">
            {mode === "join" ? (
              <label>
                Pilot nickname
                <span className="input-wrap"><UserRound size={17} /><input value={nickname} onChange={e => setNickname(e.target.value)} placeholder="e.g. SkyPilot" maxLength={20} required /></span>
              </label>
            ) : null}
            <label>
              Email address
              <span className="input-wrap"><Mail size={17} /><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required /></span>
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            {message ? <p className="form-success"><CheckCircle2 size={16} />{message}</p> : null}
            <button className="primary-button full-button" type="submit" disabled={busy}>
              {busy ? "Sending link…" : mode === "join" ? "Create my account" : "Email me a sign-in link"}
              {!busy ? <ArrowRight size={17} /> : null}
            </button>
          </form>
          <div className="privacy-note"><ShieldCheck size={16} /><span>Email is used for sign-in only. Never put personal contact details in your nickname.</span></div>
        </div>
        <div className="auth-bottom"><span>BUILT FOR THE DAYS YOU GET OUT AND FLY</span><span>360 DAYS · 52 CHECK-INS</span></div>
      </section>
    </main>
  );
}

function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [profile, setProfile] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return undefined;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) setError(sessionError.message);
      setSession(data?.session || null);
      setAuthLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setNotice("");
      setError("");
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const refreshDashboard = useCallback(async () => {
    if (!session?.user?.id) return;
    setDashboardLoading(true);
    setError("");
    try {
      const [overviewResult, ownerResult, boardResult, submissionsResult, profileResult] = await Promise.all([
        supabase.rpc("get_challenge_overview"),
        supabase.rpc("is_challenge_owner"),
        supabase.rpc("get_leaderboard"),
        supabase.from("weekly_submissions").select("week_number,submitted_at").eq("user_id", session.user.id).order("week_number"),
        supabase.from("profiles").select("nickname").eq("user_id", session.user.id).single()
      ]);
      const firstError = overviewResult.error || ownerResult.error || boardResult.error || submissionsResult.error || profileResult.error;
      if (firstError) throw firstError;
      const overview = overviewResult.data?.[0];
      if (!overview) throw new Error("Challenge settings were not found. Run supabase/schema.sql in your Supabase project.");
      setChallenge(overview);
      setIsOwner(Boolean(ownerResult.data));
      setLeaderboard(boardResult.data || []);
      setSubmissions(submissionsResult.data || []);
      setProfile(profileResult.data || null);
      setNicknameDraft(profileResult.data?.nickname || "");
    } catch (err) {
      setError(err.message || "Could not load the challenge dashboard.");
    } finally {
      setDashboardLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) refreshDashboard();
    else {
      setChallenge(null);
      setLeaderboard([]);
      setSubmissions([]);
      setProfile(null);
      setIsOwner(false);
    }
  }, [session, refreshDashboard]);

  useEffect(() => {
    if (!session) return undefined;
    const refreshTimer = window.setInterval(() => refreshDashboard(), 60000);
    const onFocus = () => refreshDashboard();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", onFocus);
    };
  }, [session, refreshDashboard]);

  const challengeStart = challenge?.start_at ? new Date(challenge.start_at) : null;
  const finished = Boolean(challenge?.is_finished);
  const started = Boolean(challenge?.is_started);
  const currentWeek = challenge?.current_week ?? null;
  const elapsedWeeks = challenge?.elapsed_weeks ?? 0;
  const myStats = useMemo(
    () => leaderboard.find(row => row.user_id === session?.user?.id) || {
      weeks_completed: 0, weeks_missed: 0, weeks_left: TOTAL_WEEKS
    },
    [leaderboard, session]
  );
  const sortedLeaderboard = useMemo(() => [...leaderboard].sort((a, b) =>
    b.weeks_completed - a.weeks_completed ||
    a.weeks_missed - b.weeks_missed ||
    a.nickname.localeCompare(b.nickname)
  ), [leaderboard]);
  const currentSubmission = submissions.find(item => item.week_number === currentWeek);
  const submissionWeeks = new Set(submissions.map(item => item.week_number));

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function startChallenge() {
    if (!isOwner || starting) return;
    const accepted = window.confirm("Start the 360-day RC flight challenge now? The first weekly period will begin immediately, and the start cannot be undone from the website.");
    if (!accepted) return;
    setStarting(true);
    setError("");
    setNotice("");
    try {
      const { error: startError } = await supabase.rpc("start_challenge");
      if (startError) throw startError;
      setNotice("Challenge started. Week 1 is now open!");
      await refreshDashboard();
    } catch (err) {
      setError(err.message || "The challenge could not be started.");
    } finally {
      setStarting(false);
    }
  }

  async function submitPhoto(event) {
    event.preventDefault();
    if (!selectedFile || !currentWeek || !session) return;
    if (!ALLOWED_IMAGE_TYPES.includes(selectedFile.type)) {
      setError("Please choose a JPG, PNG, or WebP photo.");
      return;
    }
    if (selectedFile.size > MAX_PHOTO_SIZE) {
      setError("That photo is larger than 8 MB. Choose a smaller image.");
      return;
    }
    setUploading(true);
    setError("");
    setNotice("");
    const extension = selectedFile.type === "image/png" ? "png" : selectedFile.type === "image/webp" ? "webp" : "jpg";
    const path = session.user.id + "/week-" + String(currentWeek).padStart(2, "0") + "." + extension;
    try {
      const { error: uploadError } = await supabase.storage.from("flight-proofs").upload(path, selectedFile, {
        contentType: selectedFile.type,
        upsert: false
      });
      if (uploadError) throw uploadError;
      const { error: insertError } = await supabase.from("weekly_submissions").insert({
        user_id: session.user.id,
        week_number: currentWeek,
        photo_path: path
      });
      if (insertError) {
        await supabase.storage.from("flight-proofs").remove([path]);
        throw insertError;
      }
      setSelectedFile(null);
      const input = document.getElementById("flight-photo");
      if (input) input.value = "";
      setNotice("Week " + currentWeek + " complete. Nice work getting out to the field!");
      await refreshDashboard();
    } catch (err) {
      setError(err.message || "The photo could not be submitted. Check that this week's window is still open.");
    } finally {
      setUploading(false);
    }
  }

  async function saveNickname(event) {
    event.preventDefault();
    const clean = nicknameDraft.trim();
    if (clean.length < 2 || clean.length > 20) {
      setError("Your nickname must be 2–20 characters.");
      return;
    }
    setProfileSaving(true);
    setError("");
    setNotice("");
    try {
      const { error: updateError } = await supabase.from("profiles").update({ nickname: clean }).eq("user_id", session.user.id);
      if (updateError) throw updateError;
      setNotice("Pilot nickname updated.");
      setShowProfile(false);
      await refreshDashboard();
    } catch (err) {
      setError(err.message || "Could not update your nickname. It may already be in use.");
    } finally {
      setProfileSaving(false);
    }
  }

  if (!isSupabaseConfigured) return <SetupNotice />;
  if (authLoading) {
    return <div className="loading-screen"><div className="brand-mark"><Plane size={22} /></div><span>Loading FieldLog…</span></div>;
  }
  if (!session) return <AuthScreen />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand-lockup" href="#top" aria-label="FieldLog home">
          <div className="brand-mark"><Plane size={21} /></div>
          <span>FIELDLOG</span>
        </a>
        <div className="topbar-right">
          <span className="signed-in"><span className="online-dot" />SIGNED IN</span>
          <button className="profile-button" onClick={() => setShowProfile(true)}>
            <span className="avatar">{shortName(profile?.nickname).slice(0, 1).toUpperCase()}</span>
            <span>{shortName(profile?.nickname)}</span>
            <ChevronRight size={15} />
          </button>
          <button className="icon-button" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
        </div>
      </header>

      <main className="dashboard" id="top">
        <section className="welcome-row">
          <div>
            <p className="eyebrow">PILOT DASHBOARD</p>
            <h1>Keep showing up, <em>{shortName(profile?.nickname)}.</em></h1>
            <p className="welcome-copy">A year of RC flying is built one field trip at a time.</p>
          </div>
          <div className={"challenge-status " + (finished ? "status-finished" : started ? "status-active" : "status-pending")}>
            <span className="status-dot" />
            {finished ? "CHALLENGE COMPLETE" : started ? "CHALLENGE IN PROGRESS" : "CHALLENGE NOT STARTED"}
          </div>
        </section>

        {error ? <div className="notice notice-error"><X size={17} />{error}<button onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button></div> : null}
        {notice ? <div className="notice notice-success"><CheckCircle2 size={17} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div> : null}

        <section className="challenge-banner">
          <div className="banner-art" aria-hidden="true">
            <div className="sun-disc" />
            <div className="flight-path" />
            <Plane className="banner-plane" size={92} strokeWidth={1.05} />
            <div className="banner-horizon" />
          </div>
          <div className="banner-copy">
            <p className="eyebrow">{started ? "YOUR 360-DAY RUN" : "THE RUNWAY IS READY"}</p>
            <h2>{finished ? "Challenge complete." : started ? "The challenge is underway." : "The first flight is still ahead."}</h2>
            <p>
              {started
                ? "Started " + formatDate(challenge.start_at) + ". Your 360-day window ends " + formatDate(new Date(challengeStart.getTime() + 360 * 24 * 60 * 60 * 1000).toISOString()) + "."
                : "The clock is paused. Your 360 days will only begin when the challenge owner activates it."}
            </p>
          </div>
          <div className="banner-action">
            {isOwner && !started ? (
              <button className="primary-button" onClick={startChallenge} disabled={starting}>
                <Flag size={16} />{starting ? "Starting…" : "Start challenge"}<ArrowRight size={16} />
              </button>
            ) : (
              <div className="banner-date">
                <span>START DATE</span>
                <b>{started ? formatDate(challenge.start_at) : "Not set"}</b>
              </div>
            )}
          </div>
        </section>

        <section className="stats-grid" aria-label="Your challenge progress">
          <StatCard icon={CheckCircle2} label="Weeks completed" value={myStats.weeks_completed} tone="stat-complete" footnote="Photo check-ins accepted" />
          <StatCard icon={X} label="Weeks missed" value={myStats.weeks_missed} tone="stat-missed" footnote="Finished weeks without a photo" />
          <StatCard icon={CalendarDays} label="Weeks left" value={myStats.weeks_left} tone="stat-left" footnote="Including the current open week" />
          <StatCard icon={Award} label="Weekly target" value="1 / 7d" tone="stat-target" footnote="One field photo each period" />
        </section>

        <div className="content-grid">
          <section className="panel checkin-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">WEEKLY CHECK-IN</p>
                <h2>{!started ? "Waiting for takeoff" : finished ? "Your 360 days are up" : "Week " + currentWeek}</h2>
              </div>
              <span className="panel-icon"><CloudUpload size={20} /></span>
            </div>
            {!started ? (
              <div className="empty-checkin">
                <div className="empty-icon"><Clock3 size={25} /></div>
                <h3>Not started yet</h3>
                <p>No weeks are being counted. Once the owner starts the challenge, the first 7-day upload window will open for everyone.</p>
              </div>
            ) : finished ? (
              <div className="empty-checkin">
                <div className="empty-icon success-icon"><Trophy size={25} /></div>
                <h3>That’s a wrap</h3>
                <p>The 360-day challenge has ended. Your final stats are shown above and on the leaderboard.</p>
              </div>
            ) : currentSubmission ? (
              <div className="submitted-state">
                <div className="submitted-badge"><Check size={16} />WEEK COMPLETE</div>
                <h3>You got your flight in.</h3>
                <p>Your photo for Week {currentWeek} was submitted {formatDate(currentSubmission.submitted_at)}. See you at the field next week.</p>
                <div className="submission-receipt"><CheckCircle2 size={18} /><span>Proof photo received</span><b>Week {currentWeek}</b></div>
              </div>
            ) : (
              <form className="upload-form" onSubmit={submitPhoto}>
                <div className="week-meta">
                  <span><CalendarDays size={15} />CURRENT CHECK-IN</span>
                  <span>WEEK {currentWeek} OF {TOTAL_WEEKS}</span>
                </div>
                <p className="upload-instructions">Upload a photo of your RC plane at the flying field. One photo completes this week's check-in.</p>
                <label className="drop-zone" htmlFor="flight-photo">
                  <input
                    id="flight-photo"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={event => setSelectedFile(event.target.files?.[0] || null)}
                  />
                  <span className="upload-icon"><ArrowDownToLine size={22} /></span>
                  <b>{selectedFile ? selectedFile.name : "Choose your field photo"}</b>
                  <span>{selectedFile ? (selectedFile.size / (1024 * 1024)).toFixed(1) + " MB · Ready to submit" : "JPG, PNG, or WebP · Up to 8 MB"}</span>
                  {selectedFile ? <span className="file-picked"><CheckCircle2 size={14} />PHOTO SELECTED</span> : null}
                </label>
                <button className="primary-button full-button" type="submit" disabled={!selectedFile || uploading}>
                  {uploading ? "Uploading photo…" : "Submit this week's flight"}<ArrowRight size={17} />
                </button>
                <p className="upload-note"><ShieldCheck size={14} />Your proof photo is private and is not shown on the public leaderboard.</p>
              </form>
            )}
          </section>

          <section className="panel progress-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">YOUR YEAR AT A GLANCE</p>
                <h2>Flight progress</h2>
              </div>
              <span className="panel-icon"><CalendarDays size={20} /></span>
            </div>
            <div className="progress-summary">
              <div className="progress-number"><strong>{myStats.weeks_completed}</strong><span>of {TOTAL_WEEKS} weeks</span></div>
              <div className="progress-track"><span style={{ width: (myStats.weeks_completed / TOTAL_WEEKS * 100) + "%" }} /></div>
              <div className="progress-legend">
                <span><i className="legend-dot done" />Completed</span>
                <span><i className="legend-dot missed" />Missed</span>
                <span><i className="legend-dot future" />Still ahead</span>
              </div>
            </div>
            <div className="week-grid" aria-label="52 weekly check-ins">
              {Array.from({ length: TOTAL_WEEKS }, (_unused, index) => {
                const week = index + 1;
                const complete = submissionWeeks.has(week);
                const missed = week <= elapsedWeeks && !complete;
                const current = week === currentWeek && !complete;
                const className = complete ? "week-cell done" : missed ? "week-cell missed" : current ? "week-cell current" : "week-cell future";
                return <div key={week} className={className} title={"Week " + week + (complete ? " completed" : missed ? " missed" : current ? " open now" : " upcoming")}>{week}</div>;
              })}
            </div>
            <div className="progress-footnote">
              <CircleHelp size={15} />
              <span>360 days = 51 full 7-day weeks plus a final 3-day check-in period.</span>
            </div>
          </section>
        </div>

        <section className="panel leaderboard-panel">
          <div className="panel-heading leaderboard-heading">
            <div>
              <p className="eyebrow">FRIENDS ON THE FLIGHT LINE</p>
              <h2>Leaderboard</h2>
              <p className="panel-subtitle">Everyone's progress, ranked by completed weeks and then missed weeks.</p>
            </div>
            <div className="participant-count"><Users size={16} />{leaderboard.length} {leaderboard.length === 1 ? "PILOT" : "PILOTS"}</div>
          </div>
          {dashboardLoading ? (
            <div className="leaderboard-empty">Refreshing the flight line…</div>
          ) : sortedLeaderboard.length === 0 ? (
            <div className="leaderboard-empty">
              <div className="empty-icon"><Users size={23} /></div>
              <h3>You're first on the flight line.</h3>
              <p>When your friends create accounts, they’ll appear here automatically.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>RANK / PILOT</th><th>COMPLETED</th><th>MISSED</th><th>WEEKS LEFT</th><th>PROGRESS</th></tr></thead>
                <tbody>
                  {sortedLeaderboard.map((pilot, index) => (
                    <tr key={pilot.user_id} className={pilot.user_id === session.user.id ? "current-user-row" : ""}>
                      <td>
                        <div className="pilot-cell">
                          <span className={"rank-badge rank-" + (index + 1)}>{index === 0 ? <Trophy size={15} /> : String(index + 1).padStart(2, "0")}</span>
                          <span className="pilot-avatar">{shortName(pilot.nickname).slice(0, 1).toUpperCase()}</span>
                          <b>{shortName(pilot.nickname)}{pilot.user_id === session.user.id ? <small>YOU</small> : null}</b>
                        </div>
                      </td>
                      <td><span className="table-number completed-number">{pilot.weeks_completed}</span></td>
                      <td><span className="table-number missed-number">{pilot.weeks_missed}</span></td>
                      <td><span className="table-number">{pilot.weeks_left}</span></td>
                      <td><div className="mini-progress"><span style={{ width: (pilot.weeks_completed / TOTAL_WEEKS * 100) + "%" }} /></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="leaderboard-footer"><ShieldCheck size={14} /><span>Only nicknames and challenge totals are visible to other participants. Email addresses and proof photos stay private.</span></div>
        </section>

        <footer className="dashboard-footer">
          <div className="footer-brand"><Plane size={16} />FIELDLOG</div>
          <span>52 CHECK-INS · 360 DAYS · ONE GOOD REASON TO GET OUTSIDE</span>
          <button onClick={() => setShowProfile(true)}>Account settings <ChevronRight size={14} /></button>
        </footer>
      </main>

      {showProfile ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowProfile(false); }}>
          <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
            <button className="modal-close" onClick={() => setShowProfile(false)} aria-label="Close"><X size={18} /></button>
            <div className="panel-icon"><UserRound size={20} /></div>
            <p className="eyebrow">PILOT SETTINGS</p>
            <h2 id="profile-title">Your account</h2>
            <p className="muted">Your email is used for sign-in and is never displayed on the leaderboard.</p>
            <form onSubmit={saveNickname} className="auth-form">
              <label>
                Pilot nickname
                <span className="input-wrap"><UserRound size={17} /><input value={nicknameDraft} onChange={event => setNicknameDraft(event.target.value)} minLength={2} maxLength={20} required /></span>
              </label>
              <label>
                Sign-in email
                <span className="input-wrap disabled-input"><Mail size={17} /><input value={session.user.email || ""} disabled /></span>
              </label>
              <button className="primary-button full-button" type="submit" disabled={profileSaving}>{profileSaving ? "Saving…" : "Save nickname"}<Check size={17} /></button>
            </form>
            <button className="signout-link" onClick={signOut}><LogOut size={16} />Sign out of FieldLog</button>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default App;
