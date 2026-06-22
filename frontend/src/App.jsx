import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  MapPinned, Landmark, LayoutGrid, MoonStar, SunDim, LogOut, ShieldAlert,
  LockKeyhole, CircleUser, Cctv, Tv, HardDrive, Network, Laptop,
  ChevronRight, CircleCheck, CircleX, TriangleAlert, Info as InfoIcon,
  BarChart3, Radio, Trophy, TrainFront, ArrowLeft, LogIn, ScanSearch, Settings, X
} from "lucide-react";
import MetroMap from "./components/MetroMap";
import StationDetail from "./components/StationDetail";
import { translations } from "./translations";
import { API_BASE_URL, IS_DESKTOP_MODE } from "./config";
import { isLocalAgentAvailable, syncFromServer } from "./utils/network";
import logoImg from "./logo.png";

const formatCompact = (n) => {
  const num = Number(n) || 0;
  if (num >= 1_000_000) {
    const v = num / 1_000_000;
    const value = v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/\.?0+$/, "");
    return { value, unit: "M", full: num, useCompact: true };
  }
  if (num >= 10_000) {
    return { value: Math.round(num / 1000), unit: "K", full: num, useCompact: true };
  }
  if (num >= 1_000) {
    const v = num / 1000;
    const value = Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, "");
    return { value, unit: "K", full: num, useCompact: true };
  }
  return { value: num.toLocaleString(), unit: "", full: num, useCompact: false };
};

const formatStatShort = (n) => {
  const c = formatCompact(n);
  return c.unit ? `${c.value}${c.unit}` : c.value;
};

function TotalDevicesCounter({ total, stationsCount, stationsLabel }) {
  const compact = formatCompact(total);
  const groups = total.toLocaleString().split(",");
  const digitCount = String(total).length;
  const milestone = Math.pow(10, Math.max(digitCount, 1));
  const ringPct = Math.min((total / milestone) * 100, 100);

  return (
    <div className="hero-counter" style={{ "--digit-count": digitCount }}>
      <div className="hero-counter-head">
        <div className="hero-counter-left">
          {compact.useCompact && (
            <div className="hero-counter-compact" title={total.toLocaleString()}>
              <span className="hero-counter-num">{compact.value}</span>
              <span className="hero-counter-unit">{compact.unit}</span>
            </div>
          )}
          <div className="hero-digit-board" aria-label={total.toLocaleString()}>
            {groups.map((group, gi) => (
              <React.Fragment key={gi}>
                {gi > 0 && <span className="hero-digit-sep">,</span>}
                <div className="hero-digit-group">
                  {group.split("").map((d, di) => (
                    <span key={`${gi}-${di}`} className="hero-digit">{d}</span>
                  ))}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="hero-counter-ring" style={{ "--ring-pct": ringPct }}>
          <div className="hero-counter-ring-inner">
            <Radio size={22} strokeWidth={1.75} />
          </div>
        </div>
      </div>
      <div className="hero-counter-meta">
        {compact.useCompact && (
          <span className="hero-counter-exact">{total.toLocaleString()}</span>
        )}
        <span className="hero-counter-stations">{stationsCount} {stationsLabel}</span>
      </div>
    </div>
  );
}

const isTokenExpired = (token) => {
  if (!token || token === "undefined" || token === "null") return true;
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const payload = JSON.parse(jsonPayload);
    if (payload.exp) {
      const currentTime = Math.floor(Date.now() / 1000);
      return payload.exp < currentTime;
    }
    return false;
  } catch (e) {
    return true;
  }
};

const VALID_PAGES = ["dashboard", "map", "station-detail"];

function readSavedPage() {
  const page = localStorage.getItem("active_page");
  return VALID_PAGES.includes(page) ? page : "dashboard";
}

function readSavedStationId() {
  const raw = localStorage.getItem("selected_station_id");
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

export default function App() {
  const [token, setToken] = useState(() => {
    const savedToken = localStorage.getItem("token_marketing");
    if (savedToken && !isTokenExpired(savedToken)) {
      return savedToken;
    }
    if (savedToken) {
      localStorage.removeItem("token_marketing");
    }
    return null;
  });
  const [currentUser, setCurrentUser] = useState(null);
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");
  const [lang, setLang] = useState(localStorage.getItem("lang") || "uz");
  const [apiStations, setApiStations] = useState([]);
  const [selectedStationId, setSelectedStationId] = useState(readSavedStationId);
  const [stationsLoading, setStationsLoading] = useState(false);

  // Layout Routing State
  const [activePage, setActivePage] = useState(readSavedPage);

  // Toast Notification State
  const [notifications, setNotifications] = useState([]);
  const toastTimersRef = useRef(new Map());

  // Login form inputs
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [localAgentOk, setLocalAgentOk] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncOnLoginRef = useRef(false);
  const settingsBtnRef = useRef(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

  const LANG_OPTIONS = [
    { code: "uz", flag: "🇺🇿", label: "UZ", name: "O'zbek" },
    { code: "ru", flag: "🇷🇺", label: "RU", name: "Русский" },
    { code: "en", flag: "🇬🇧", label: "EN", name: "English" },
  ];

  // Retrieve translation dictionary
  const t = translations[lang] || translations.uz;

  // Apply theme class
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Save language
  useEffect(() => {
    localStorage.setItem("lang", lang);
  }, [lang]);

  // Sahifani refreshdan keyin saqlash
  useEffect(() => {
    localStorage.setItem("active_page", activePage);
  }, [activePage]);

  useEffect(() => {
    if (selectedStationId != null) {
      localStorage.setItem("selected_station_id", String(selectedStationId));
    } else {
      localStorage.removeItem("selected_station_id");
    }
  }, [selectedStationId]);

  // Bekat detail — id yo'q yoki noto'g'ri bo'lsa xaritaga
  useEffect(() => {
    if (activePage === "station-detail" && !selectedStationId) {
      setActivePage("map");
      return;
    }
    if (activePage !== "station-detail" || !selectedStationId || !apiStations.length) return;
    const exists = apiStations.some((s) => s.id === selectedStationId);
    if (!exists) {
      setActivePage("map");
      setSelectedStationId(null);
    }
  }, [apiStations, activePage, selectedStationId]);

  // Load user details and station list if token exists
  useEffect(() => {
    if (token) {
      fetchCurrentUser();
      fetchStations();
    } else {
      setCurrentUser(null);
      setApiStations([]);
    }
  }, [token]);

  // (logs removed — dashboard uses apiStations directly)

  const dismissNotification = useCallback((id) => {
    const timers = toastTimersRef.current.get(id);
    if (timers?.leave) clearTimeout(timers.leave);
    if (timers?.remove) clearTimeout(timers.remove);

    setNotifications(prev => {
      const target = prev.find(n => n.id === id);
      if (!target || target.leaving) return prev;
      return prev.map(n => (n.id === id ? { ...n, leaving: true } : n));
    });

    const removeTimer = setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
      toastTimersRef.current.delete(id);
    }, 350);
    toastTimersRef.current.set(id, { remove: removeTimer });
  }, []);

  const showNotification = (type, title, message) => {
    const id = Date.now() + Math.random().toString(36).substr(2, 9);
    const newNotif = { id, type, title, message, leaving: false };
    setNotifications(prev => [...prev, newNotif]);

    const leaveTimer = setTimeout(() => dismissNotification(id), 4000);
    toastTimersRef.current.set(id, { leave: leaveTimer });
  };

  const renderToastOverlay = () => {
    if (!notifications.length) return null;

    return (
      <div className="toast-overlay" aria-live="polite">
        <div className="toast-stack">
          {notifications.map(notif => {
            let IconComponent = InfoIcon;
            if (notif.type === "success") IconComponent = CircleCheck;
            if (notif.type === "error") IconComponent = CircleX;
            if (notif.type === "warning") IconComponent = TriangleAlert;

            return (
              <div key={notif.id} className={`toast ${notif.type} ${notif.leaving ? "leaving" : ""}`}>
                <button
                  type="button"
                  className="toast-close"
                  onClick={() => dismissNotification(notif.id)}
                  aria-label={t.close}
                >
                  <X size={16} strokeWidth={1.75} />
                </button>
                <div className="toast-icon-ring">
                  <IconComponent className="toast-icon" size={28} strokeWidth={1.75} />
                </div>
                <div className="toast-body">
                  {notif.title && <div className="toast-title">{notif.title}</div>}
                  {notif.message && <div className="toast-message">{notif.message}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const fetchCurrentUser = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/get-me/`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (response.status === 401 || response.status === 403) {
        handleLogout();
        return;
      }
      if (!response.ok) throw new Error("Failed to load user info");
      const data = await response.json();
      setCurrentUser(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchStations = async () => {
    setStationsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/stations/`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (response.status === 401 || response.status === 403) {
        handleLogout();
        return;
      }
      const data = await response.json();
      const list = Array.isArray(data) ? data : data.results || [];
      setApiStations(list);
    } catch (err) {
      console.error("Failed to load stations list", err);
    } finally {
      setStationsLoading(false);
    }
  };

  // (fetchGlobalLogs removed — dashboard computes stats from apiStations)

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/token/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username: usernameInput,
          password: passwordInput
        })
      });

      if (!response.ok) {
        throw new Error(t.loginFailed);
      }

      const data = await response.json();
      if (data.access) {
        localStorage.setItem("token_marketing", data.access);
        setToken(data.access);
        setAuthError("");
        showNotification("success", t.welcomeLogin, t.loginSuccess);
      } else {
        throw new Error("Token loading error");
      }
    } catch (err) {
      setAuthError(err.message || t.loginConnectionError);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token_marketing");
    localStorage.removeItem("active_page");
    localStorage.removeItem("selected_station_id");
    syncOnLoginRef.current = false;
    setToken(null);
    setCurrentUser(null);
    setSelectedStationId(null);
    setActivePage("map");
  };

  useEffect(() => {
    if (!token) return;
    isLocalAgentAvailable().then(setLocalAgentOk);
    const timer = setInterval(() => isLocalAgentAvailable(true).then(setLocalAgentOk), 15000);
    return () => clearInterval(timer);
  }, [token]);

  useEffect(() => {
    if (!token) {
      syncOnLoginRef.current = false;
      return;
    }
    if (!localAgentOk || !IS_DESKTOP_MODE || syncOnLoginRef.current) return;
    syncOnLoginRef.current = true;
    syncFromServer(token).catch(() => {});
  }, [token, localAgentOk]);

  const handleSyncFromServer = async () => {
    if (!token || !localAgentOk) return;
    setSyncing(true);
    try {
      await syncFromServer(token);
      showNotification("success", t.title, t.syncSuccess);
    } catch {
      showNotification("error", t.errorTitle, t.syncFailed);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!settingsOpen || !settingsBtnRef.current) return;

    const updatePosition = () => {
      const rect = settingsBtnRef.current.getBoundingClientRect();
      const popoverH = 148;
      const top = Math.max(
        12,
        Math.min(rect.top + rect.height / 2 - popoverH / 2, window.innerHeight - popoverH - 12)
      );
      setPopoverPos({ top, left: rect.right + 10 });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [settingsOpen]);

  const renderSettingsPopover = () => {
    if (!settingsOpen) return null;

    return createPortal(
      <>
        <div className="settings-popover-backdrop" onClick={() => setSettingsOpen(false)} />
        <div
          className="settings-popover"
          style={{ top: popoverPos.top, left: popoverPos.left }}
          aria-label={t.menuSettings}
        >
          <div className="settings-popover-header">
            <span className="settings-popover-title">{t.menuSettings}</span>
            <button type="button" className="settings-popover-close" onClick={() => setSettingsOpen(false)} aria-label={t.close}>
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>

          <div className="settings-popover-row">
            <span className="settings-popover-label">{t.theme}</span>
            <div className="settings-theme-switch" role="group" aria-label={t.theme}>
              <button
                type="button"
                className={`settings-theme-pill ${theme === "light" ? "active" : ""}`}
                onClick={() => setTheme("light")}
                title="Light"
              >
                <SunDim size={14} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className={`settings-theme-pill ${theme === "dark" ? "active" : ""}`}
                onClick={() => setTheme("dark")}
                title="Dark"
              >
                <MoonStar size={14} strokeWidth={1.75} />
              </button>
            </div>
          </div>

          <div className="settings-popover-row">
            <span className="settings-popover-label">{t.language}</span>
            <div className="settings-lang-switch" role="group" aria-label={t.language}>
              {LANG_OPTIONS.map((opt) => (
                <button
                  key={opt.code}
                  type="button"
                  className={`settings-lang-pill ${lang === opt.code ? "active" : ""}`}
                  onClick={() => setLang(opt.code)}
                  title={opt.name}
                >
                  <span className="settings-lang-pill-flag">{opt.flag}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </>,
      document.body
    );
  };

  const getStationDeviceCount = (station) => {
    let count = 0;
    count += (station.cameras || []).reduce((acc, d) => acc + (d.quantity || 1), 0);
    count += (station.metal_detectors || []).reduce((acc, d) => acc + (d.quantity || 1), 0);
    count += (station.monitors || []).reduce((acc, d) => acc + (d.quantity || 1), 0);
    count += (station.computers || []).reduce((acc, d) => acc + (d.quantity || 1), 0);
    count += (station.nvrs || []).reduce((acc, d) => acc + (d.quantity || 1), 0);
    count += (station.switches || []).reduce((acc, d) => acc + (d.quantity || 1), 0);
    return count;
  };

  // Render Login page if not authenticated
  if (!token) {
    return (
      <div className="login-page">
        <div className="login-page-pattern" aria-hidden="true" />
        <div className="login-page-bg" aria-hidden="true">
          <div className="login-blob login-blob--1" />
          <div className="login-blob login-blob--2" />
          <div className="login-blob login-blob--3" />
        </div>
        <form className="login-card animate-scale-in" onSubmit={handleLoginSubmit}>
          <div className="login-logo">
            <img src={logoImg} alt="Logo" className="login-logo-img" />
          </div>
          <div className="login-header">
            <h2>{t.loginTitle}</h2>
            <p>{t.loginSubtitle}</p>
          </div>

          {authError && (
            <div className="auth-error-banner">
              <ShieldAlert size={18} strokeWidth={1.75} />
              <span>{authError}</span>
            </div>
          )}

          <div className="form-group">
            <label>{t.username}</label>
            <div className="input-icon-wrap login-input-wrap">
              <span className="input-icon login-input-icon"><CircleUser size={17} strokeWidth={1.75} /></span>
              <input
                type="text"
                className="form-input login-form-input"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="admin"
                required
              />
            </div>
          </div>

          <div className="form-group login-form-last">
            <label>{t.password}</label>
            <div className="input-icon-wrap login-input-wrap">
              <span className="input-icon login-input-icon"><LockKeyhole size={17} strokeWidth={1.75} /></span>
              <input
                type="password"
                className="form-input login-form-input"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary login-submit-btn" disabled={authLoading}>
            <span className="login-submit-icon">
              <LogIn size={17} strokeWidth={1.75} />
            </span>
            {authLoading ? t.loading : t.signIn}
          </button>

          <div className="login-footer-bar">
            <div className="login-footer-controls">
              <div className="login-theme-switch" role="group" aria-label={t.theme}>
                <button
                  type="button"
                  className={`login-theme-pill ${theme === "light" ? "active" : ""}`}
                  onClick={() => setTheme("light")}
                  title="Light"
                >
                  <SunDim size={15} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className={`login-theme-pill ${theme === "dark" ? "active" : ""}`}
                  onClick={() => setTheme("dark")}
                  title="Dark"
                >
                  <MoonStar size={15} strokeWidth={1.75} />
                </button>
              </div>
              <div className="login-lang-switch" role="group" aria-label={t.language}>
                {LANG_OPTIONS.map((opt) => (
                  <button
                    key={opt.code}
                    type="button"
                    className={`login-lang-pill ${lang === opt.code ? "active" : ""}`}
                    onClick={() => setLang(opt.code)}
                    title={opt.name}
                  >
                    <span className="login-lang-flag">{opt.flag}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </form>

        {renderToastOverlay()}
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <img src={logoImg} alt="Logo" style={{ width: "32px", height: "32px", objectFit: "contain", borderRadius: "6px" }} />
          </div>
          <div className="sidebar-brand-text">
            {t.title}
            <span>{t.appSubtitle}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">{t.menuSection}</div>
          <button
            className={`sidebar-nav-item ${activePage === "dashboard" ? "active" : ""}`}
            onClick={() => setActivePage("dashboard")}
          >
            <span className="nav-icon-wrap"><LayoutGrid size={17} strokeWidth={1.75} /></span>
            <span className="sidebar-nav-label">{t.menuDashboard}</span>
          </button>

          <button
            className={`sidebar-nav-item ${activePage === "map" || activePage === "station-detail" ? "active" : ""}`}
            onClick={() => setActivePage("map")}
          >
            <span className="nav-icon-wrap"><TrainFront size={17} strokeWidth={1.75} /></span>
            <span className="sidebar-nav-label">{t.menuMap}</span>
            {apiStations.length > 0 && (
              <span className="sidebar-badge">{apiStations.length}</span>
            )}
          </button>
        </nav>

        <div className="sidebar-footer">
          {currentUser && (
            <div className="sidebar-user">
              <div className="sidebar-user-avatar">
                {currentUser.username.substring(0, 2).toUpperCase()}
              </div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{currentUser.username}</div>
                <div className="sidebar-user-role">{t.user}</div>
              </div>
            </div>
          )}

          <div className="sidebar-divider" />

          <button
            ref={settingsBtnRef}
            type="button"
            className={`sidebar-nav-item sidebar-settings-btn ${settingsOpen ? "active" : ""}`}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <span className="nav-icon-wrap"><Settings size={17} strokeWidth={1.75} /></span>
            <span className="sidebar-nav-label">{t.menuSettings}</span>
            <ChevronRight size={15} strokeWidth={1.75} className="sidebar-settings-arrow" />
          </button>

          <button className="btn btn-danger sidebar-logout-btn" onClick={handleLogout}>
            <LogOut size={16} strokeWidth={1.75} /> {t.logout}
          </button>
        </div>
      </aside>

      {renderSettingsPopover()}

      {/* Main Content Area */}
      <main className="main-content">
        <div className="main-content-pattern" aria-hidden="true" />
        {(localAgentOk || IS_DESKTOP_MODE) && (
          <div className="local-agent-banner">
            <span className="local-agent-dot" />
            <span>{localAgentOk ? t.localAgentActive : t.localAgentInactive}</span>
            {localAgentOk && (
              <button type="button" className="btn btn-secondary btn-sm" disabled={syncing} onClick={handleSyncFromServer}>
                {syncing ? t.loading : t.syncFromServer}
              </button>
            )}
          </div>
        )}
        <div className={`page-content ${activePage === "map" ? "page-content--map" : ""}`}>

          {/* Map Page */}
          {activePage === "map" && (
            <>
              <div className="page-header">
                <div className="page-title-row">
                  <span className="page-title-icon"><TrainFront size={20} strokeWidth={1.75} /></span>
                  <h1 className="page-title">{t.menuMap}</h1>
                </div>
              </div>
              <div className="map-page">
                <MetroMap
                  apiStations={apiStations}
                  onStationSelect={(id) => {
                    setSelectedStationId(id);
                    setActivePage("station-detail");
                  }}
                  selectedStationId={selectedStationId}
                  t={t}
                />
              </div>
            </>
          )}

          {/* Dashboard Page */}
          {activePage === "dashboard" && (() => {
            // Compute stats from apiStations
            const totalCams = apiStations.reduce((s, st) => s + (st.cameras || []).reduce((a, d) => a + (d.quantity || 1), 0), 0);
            const totalDet = apiStations.reduce((s, st) => s + (st.metal_detectors || []).reduce((a, d) => a + (d.quantity || 1), 0), 0);
            const totalMon = apiStations.reduce((s, st) => s + (st.monitors || []).reduce((a, d) => a + (d.quantity || 1), 0), 0);
            const totalNvr = apiStations.reduce((s, st) => s + (st.nvrs || []).reduce((a, d) => a + (d.quantity || 1), 0), 0);
            const totalSwi = apiStations.reduce((s, st) => s + (st.switches || []).reduce((a, d) => a + (d.quantity || 1), 0), 0);
            const totalComp = apiStations.reduce((s, st) => s + (st.computers || []).reduce((a, d) => a + (d.quantity || 1), 0), 0);
            const totalAll = totalCams + totalDet + totalMon + totalNvr + totalSwi + totalComp;

            const top10 = [...apiStations]
              .map(st => ({ ...st, _total: getStationDeviceCount(st) }))
              .sort((a, b) => b._total - a._total)
              .slice(0, 10);

            const maxDevices = top10[0]?._total || 1;

            const lineColor = (st) => {
              const name = (st.line_name || "").toLowerCase();
              if (name.includes("chilonzor") || name.includes("blue")) return { color: "var(--line-blue)", bg: "rgba(37,99,235,0.12)" };
              if (name.includes("yunusobod") || name.includes("green")) return { color: "var(--line-green)", bg: "rgba(16,185,129,0.12)" };
              if (name.includes("zbekiston") || name.includes("red")) return { color: "var(--line-red)", bg: "rgba(220,38,38,0.12)" };
              return { color: "var(--line-yellow)", bg: "rgba(217,119,6,0.12)" };
            };

            const statCards = [
              { icon: <Landmark size={22} strokeWidth={1.75} />, label: t.totalStations, value: apiStations.length, variant: "icon-stat--blue" },
              { icon: <Cctv size={22} strokeWidth={1.75} />, label: t.totalCameras, value: totalCams, variant: "icon-stat--cyan" },
              { icon: <ScanSearch size={22} strokeWidth={1.75} />, label: t.totalMetalDetectors, value: totalDet, variant: "icon-stat--red" },
              { icon: <Tv size={22} strokeWidth={1.75} />, label: t.totalMonitors, value: totalMon, variant: "icon-stat--purple" },
              { icon: <HardDrive size={22} strokeWidth={1.75} />, label: t.totalNvrs, value: totalNvr, variant: "icon-stat--amber" },
              { icon: <Network size={22} strokeWidth={1.75} />, label: t.totalSwitches, value: totalSwi, variant: "icon-stat--green" },
              { icon: <Laptop size={22} strokeWidth={1.75} />, label: t.totalComputers, value: totalComp, variant: "icon-stat--indigo" },
            ];

            return (
              <div className="dashboard-page animate-fade-in">
                <div className="page-header page-header--flush">
                  <div className="page-title-row">
                    <span className="page-title-icon"><BarChart3 size={24} strokeWidth={1.75} /></span>
                    <div>
                      <h1 className="page-title">{t.menuDashboard}</h1>
                      <p className="page-subtitle">{t.dashboardSubtitle}</p>
                    </div>
                  </div>
                </div>

                <div className="dashboard-main-row">
                  <div className="dashboard-hero">
                    <div className="dashboard-hero-label">{t.totalDevicesAll}</div>
                    <TotalDevicesCounter
                      total={totalAll}
                      stationsCount={apiStations.length}
                      stationsLabel={t.totalStations}
                    />
                    <div className="dashboard-hero-pills">
                      {statCards.filter(c => c.value > 0).map((card, i) => (
                        <span key={i} className="dashboard-pill" title={card.value.toLocaleString()}>
                          {React.cloneElement(card.icon, { size: 13, strokeWidth: 1.75 })}
                          <strong>{formatStatShort(card.value)}</strong>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="dashboard-summary">
                    <div className="dashboard-summary-title">{t.totalDevicesAll}</div>
                    {statCards.map((card, i) => (
                      <div key={i} className="dashboard-summary-row">
                        <div className="dashboard-summary-left">
                          <span className={`icon-stat ${card.variant}`} style={{ width: 32, height: 32, borderRadius: 8 }}>
                            {React.cloneElement(card.icon, { size: 16 })}
                          </span>
                          <span>{card.label}</span>
                        </div>
                        <span className="dashboard-summary-value" title={card.value.toLocaleString()}>
                          {formatStatShort(card.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="dashboard-stat-grid">
                  {statCards.map((card, i) => (
                    <div key={i} className="card dashboard-stat-card">
                      <div className={`icon-stat ${card.variant}`}>{card.icon}</div>
                      <div className="dashboard-stat-body">
                        <div className="dashboard-stat-value" title={card.value.toLocaleString()}>
                          {formatStatShort(card.value)}
                        </div>
                        <div className="dashboard-stat-label">{card.label}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="card dashboard-table-card">
                  <div className="dashboard-table-header">
                    <h3 className="section-title-row" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.1rem", color: "var(--text-primary)", margin: 0 }}>
                      <span className="section-title-icon"><Trophy size={16} strokeWidth={1.75} /></span>
                      {t.top10Stations}
                    </h3>
                  </div>
                  <div className="table-wrapper" style={{ border: "none", borderRadius: 0, boxShadow: "none" }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          {[t.rank, t.stationName, t.lineName, t.devicesCount, ""].map((h, i) => (
                            <th key={i} style={{ textAlign: i === 0 ? "center" : i === 3 ? "right" : "left" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {top10.map((st, idx) => {
                          const lc = lineColor(st);
                          const pct = Math.round((st._total / maxDevices) * 100);
                          const rankClass = idx === 0 ? "gold" : idx === 1 ? "silver" : idx === 2 ? "bronze" : "default";
                          return (
                            <tr
                              key={st.id}
                              style={{ cursor: "pointer" }}
                              onClick={() => { setSelectedStationId(st.id); setActivePage("station-detail"); }}
                            >
                              <td style={{ textAlign: "center", width: 48 }}>
                                <span className={`dashboard-rank ${rankClass}`}>{idx + 1}</span>
                              </td>
                              <td>
                                <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: "0.95rem" }}>{st.name}</span>
                              </td>
                              <td>
                                <span className="badge badge-info" style={{ background: lc.bg, color: lc.color }}>
                                  {st.line_name || "—"}
                                </span>
                              </td>
                              <td style={{ textAlign: "right", width: 200 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", justifyContent: "flex-end" }}>
                                  <div style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--bg-tertiary)", overflow: "hidden", minWidth: 80 }}>
                                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: lc.color }} />
                                  </div>
                                  <span className="dashboard-summary-value" style={{ minWidth: 28 }}>{st._total}</span>
                                </div>
                              </td>
                              <td style={{ textAlign: "right", width: 48 }}>
                                <ChevronRight size={16} strokeWidth={1.75} style={{ color: "var(--text-muted)" }} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Station Detail Fullscreen Page */}
          {activePage === "station-detail" && (
            <>
              <div className="page-header page-header--with-actions">
                <div className="page-title-row">
                  <span className="page-title-icon"><MapPinned size={20} strokeWidth={1.75} /></span>
                  <div>
                    <div className="page-breadcrumb">
                      <button type="button" className="page-breadcrumb-link" onClick={() => setActivePage("map")}>
                        {t.menuMap}
                      </button>
                      <ChevronRight size={13} strokeWidth={1.75} />
                      <span>{apiStations.find(s => s.id === selectedStationId)?.name || "—"}</span>
                    </div>
                    <h1 className="page-title">
                      {apiStations.find(s => s.id === selectedStationId)?.name || "—"}
                    </h1>
                  </div>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActivePage("map")}>
                  <ArrowLeft size={15} strokeWidth={1.75} /> {t.backToMap}
                </button>
              </div>
              <StationDetail
                stationId={selectedStationId}
                apiStations={apiStations}
                token={token}
                t={t}
                refreshStation={fetchStations}
                showNotification={showNotification}
              />
            </>
          )}

        </div>
      </main>

      {renderToastOverlay()}
    </div>
  );
}
