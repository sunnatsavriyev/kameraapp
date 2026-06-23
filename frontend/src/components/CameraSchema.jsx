import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { API_BASE_URL, LOCAL_AGENT_URL, IS_DESKTOP_MODE } from "../config";
import {
  formatCameraNumber,
  getConnectionLabel,
  getConnectionStyle,
  localizeConnectionResult,
  shouldBlockCameraSave,
  getBlockedSaveMessage,
} from "../translations";
import { isLocalNetworkIp, isLocalAgentAvailable, pickConnectionApiBase } from "../utils/network";
import { getConnectionTestOptions } from "../utils/cameraMode";
import { resolveStreamMode, getSchemaLiveUrl, canShowLiveStream } from "../utils/stream";
import {
  Cctv, CirclePlus, PencilLine, Eye, EyeOff, Wifi, WifiOff, Copy,
  ExternalLink, X, Save, CircleCheck, Loader,
  Video, Settings, MapPin, LockKeyhole, CircleUser, Globe2, RotateCcw,
  ChevronDown, ChevronUp, Upload, RefreshCw, Trash2, Image as ImageIcon,
  FileImage, Hash, ZoomIn
} from "lucide-react";

async function testSchemaCameraConnection(token, payload, t, agentAvailable = false, options = {}) {
  const { quick = false, timeoutMs = quick ? 12000 : 35000 } = options;
  const body = quick ? { ...payload, quick: true } : payload;
  const agentBase = pickConnectionApiBase(payload.ip_address, agentAvailable);
  const bases = agentBase ? [agentBase, API_BASE_URL] : [API_BASE_URL];
  let last = null;
  for (const base of bases) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`${base}/api/schema-cameras/test-connection/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        last = localizeConnectionResult(t, {
          ok: false,
          status: data.status || "error",
          message: data.message,
        });
        continue;
      }
      const result = localizeConnectionResult(t, data);
      if (base === agentBase && result.ok) return result;
      if (result.status === "local_only" && agentBase && base === API_BASE_URL) continue;
      if (result.status === "local_only" && !agentAvailable && isLocalNetworkIp(payload.ip_address)) {
        return localizeConnectionResult(t, {
          ...result,
          ok: false,
          message: t.localAgentRequired,
        });
      }
      return result;
    } catch (err) {
      clearTimeout(timer);
      const timedOut = err?.name === "AbortError";
      last = localizeConnectionResult(t, {
        ok: false,
        status: timedOut ? "offline" : "error",
        message: timedOut ? t.connTimeout : t.connServerError,
      });
    }
  }
  return last || localizeConnectionResult(t, { ok: false, status: "error", message: t.connServerError });
}

function ConnectionBadge({ status, checking, compact, t }) {
  const key = checking ? "checking" : (status || "offline");
  const meta = getConnectionStyle(key, checking);
  const label = getConnectionLabel(t, status, checking);
  return (
    <span
      title={label}
      style={{
        fontSize: compact ? "0.68rem" : "0.72rem",
        fontWeight: 700,
        padding: compact ? "2px 7px" : "3px 8px",
        borderRadius: 999,
        background: meta.bg,
        color: meta.color,
        border: `1px solid ${meta.border}`,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        whiteSpace: "nowrap",
      }}
    >
      {checking && <Loader size={10} style={{ animation: "spin 1s linear infinite" }} />}
      {!checking && key === "live" && (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color, animation: "pulse-dot 1.2s infinite" }} />
      )}
      {label}
    </span>
  );
}

// ─── KAMERA PINI (SXEMADA) ───────────────────────────────────────────────
function CameraPin({ cam, selected, highlighted, isDragging, justDropped }) {
  const isLive = cam?.connection_ok === true;
  const isOffline = cam?.connection_ok === false;

  const wrapperClass = [
    "camera-pin-wrapper",
    selected && "is-selected",
    highlighted && !selected && "is-highlighted",
    isDragging && "is-dragging",
    justDropped && "is-dropped",
    isLive ? "is-active" : isOffline ? "is-offline" : "is-inactive",
  ].filter(Boolean).join(" ");

  return (
    <div className={wrapperClass} title={
      cam.connection_message
        ? `${cam.label || `Kamera #${cam.position_number}`} — ${cam.connection_message}`
        : (cam.label || `Kamera #${cam.position_number} (${cam.ip_address})`)
    }>
      {isLive && !isDragging && (
        <div className="camera-pin-pulse" />
      )}
      <div className="camera-pin-dot">
        <span className="camera-pin-num">{cam.position_number}</span>
      </div>
      {cam.label && !isDragging && (
        <div className="camera-pin-label">{cam.label}</div>
      )}
    </div>
  );
}

// ─── SCHEMA CAMERA STREAM MODAL ──────────────────────────────────────────
function SchemaCameraModal({ cam, stationId, token, t, onClose, onSave, clickedCoordinates, nextPositionNumber, initialTab = "view", showNotification }) {
  const [tab, setTab] = useState(() => {
    if (!cam?.id) return "settings";
    return initialTab === "settings" ? "settings" : "view";
  });
  const [fields, setFields] = useState({
    position_number: cam?.position_number ?? nextPositionNumber ?? 1,
    label: cam?.label || "",
    ip_address: cam?.ip_address || "",
    login: cam?.login || "admin",
    password: cam?.password || "",
    rtsp_port: cam?.rtsp_port || 554,
    http_port: cam?.http_port || 80,
    stream_path: cam?.stream_path || "/Streaming/Channels/101",
    pos_x: cam?.pos_x ?? clickedCoordinates?.x ?? 50,
    pos_y: cam?.pos_y ?? clickedCoordinates?.y ?? 50,
    direction: cam?.direction || 0,
    is_active: cam?.is_active !== false,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [liveZoomed, setLiveZoomed] = useState(false);
  const [backendErrorDetail, setBackendErrorDetail] = useState("");
  const [directConnect, setDirectConnect] = useState(false);
  const [directPath, setDirectPath] = useState("/cgi-bin/snapshot.cgi");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [connectionChecking, setConnectionChecking] = useState(false);
  const [streamAllowed, setStreamAllowed] = useState(false);
  const [localAgentAvailable, setLocalAgentAvailable] = useState(false);
  const [savedCam, setSavedCam] = useState(cam);

  const isNew = !savedCam?.id;

  useEffect(() => {
    if (!IS_DESKTOP_MODE) return;
    isLocalAgentAvailable().then(setLocalAgentAvailable);
    const timer = setInterval(() => isLocalAgentAvailable(true).then(setLocalAgentAvailable), 12000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (isLocalNetworkIp(fields.ip_address)) {
      setDirectConnect(!localAgentAvailable);
    }
  }, [fields.ip_address, localAgentAvailable]);

  useEffect(() => {
    setSavedCam(cam);
  }, [cam]);

  useEffect(() => {
    if (!savedCam?.id) {
      setTab("settings");
    } else {
      setTab(initialTab === "settings" ? "settings" : "view");
    }
  }, [savedCam?.id, initialTab]);

  useEffect(() => {
    setInitialLoading(true);
    setImgError(false);
    setBackendErrorDetail("");
    setStreamAllowed(false);
  }, [directConnect, tab]);

  const runConnectionTest = useCallback(async (overrideFields) => {
    const f = overrideFields || fields;
    setConnectionChecking(true);
    const payload = {
      ip_address: f.ip_address,
      login: f.login,
      password: f.password,
      http_port: parseInt(f.http_port) || 80,
      rtsp_port: parseInt(f.rtsp_port) || 554,
      stream_path: f.stream_path,
    };
    if (savedCam?.id) payload.id = savedCam.id;
    const agentOk = IS_DESKTOP_MODE && (localAgentAvailable || await isLocalAgentAvailable(true));
    setLocalAgentAvailable(agentOk);
    const result = await testSchemaCameraConnection(token, payload, t, agentOk);
    setConnectionStatus(result);
    setStreamAllowed(canShowLiveStream({ connectionStatus: result, localAgentAvailable: agentOk, ip: f.ip_address }));
    setConnectionChecking(false);
    return result;
  }, [fields, savedCam?.id, token, t, localAgentAvailable]);

  useEffect(() => {
    if (tab !== "view" || isNew || !savedCam?.id) return;
    let cancelled = false;
    (async () => {
      const result = await runConnectionTest();
      if (cancelled) return;
      setStreamAllowed(canShowLiveStream({
        connectionStatus: result,
        localAgentAvailable,
        ip: fields.ip_address,
      }) || result.ok);
      if (!result.ok) {
        setImgError(true);
        setInitialLoading(false);
        setBackendErrorDetail(result.message);
      } else {
        setImgError(false);
        setInitialLoading(true);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, savedCam?.id, isNew, runConnectionTest]);

  useEffect(() => {
    let interval;
    if (tab === "view" && fields.ip_address && savedCam?.id && streamAllowed) {
      interval = setInterval(() => setTick(prev => prev + 1), 800);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [tab, fields.ip_address, savedCam?.id, streamAllowed]);

  const handleChange = (key, val) =>
    setFields(prev => ({ ...prev, [key]: val }));

  const getRtspUrl = () => {
    const path = fields.stream_path || "/Streaming/Channels/101";
    return `rtsp://${fields.login}:${fields.password}@${fields.ip_address}:${fields.rtsp_port}${path}`;
  };

  const handleCopyRtsp = () => {
    navigator.clipboard.writeText(getRtspUrl()).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!fields.ip_address?.trim()) {
      showNotification?.("warning", t.errorTitle, t.ipRequired);
      return;
    }
    if (!fields.password?.trim()) {
      showNotification?.("warning", t.errorTitle, t.passwordRequired);
      return;
    }

    setSaving(true);
    try {
      const testResult = await runConnectionTest();
      setConnectionStatus(testResult);

      if (shouldBlockCameraSave(testResult)) {
        showNotification?.("error", t.cameraNotAdded, getBlockedSaveMessage(t, testResult));
        return;
      }

      const payload = {
        ...fields,
        station: stationId,
        rtsp_port: parseInt(fields.rtsp_port) || 554,
        http_port: parseInt(fields.http_port) || 80,
        pos_x: parseFloat(fields.pos_x) || 50,
        pos_y: parseFloat(fields.pos_y) || 50,
        direction: parseInt(fields.direction) || 0,
        position_number: parseInt(fields.position_number) || 1,
        is_active: testResult.ok ? fields.is_active !== false : false,
      };

      const url = isNew
        ? `${API_BASE_URL}/api/schema-cameras/`
        : `${API_BASE_URL}/api/schema-cameras/${savedCam.id}/`;

      const resp = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error("Save failed");
      const data = await resp.json();
      setSavedCam(data);
      onSave(data, testResult);

      if (testResult.ok || testResult.status === "offline") {
        onClose();
      } else {
        setTab("settings");
        setStreamAllowed(false);
      }
    } catch {
      showNotification?.("error", t.errorTitle, t.saveCameraFailed);
    } finally {
      setSaving(false);
    }
  };

  const executeDelete = async () => {
    if (!savedCam?.id) return;
    setDeleting(true);
    try {
      const resp = await fetch(`${API_BASE_URL}/api/schema-cameras/${savedCam.id}/`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        onSave(null);
        onClose();
      }
    } catch {
      // Handled
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleDelete = () => {
    if (!savedCam?.id) return;
    setShowDeleteConfirm(true);
  };

  const streamMode = resolveStreamMode({
    ip: fields.ip_address,
    localAgentAvailable,
    connectionStatus,
    isLocalOnly: savedCam?.is_local_only,
  });

  const liveUrl = getSchemaLiveUrl({
    camId: savedCam?.id,
    fields,
    token,
    mode: directConnect ? "direct" : streamMode,
    directPath,
    tick,
  });

  const headerStatus = connectionChecking
    ? "checking"
    : (connectionStatus?.status || (isNew ? "offline" : "checking"));

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content animate-scale-in"
        style={{ maxWidth: 540, width: "95vw", borderRadius: "1rem", overflow: "hidden" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header" style={{ padding: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: "linear-gradient(135deg, #2563eb, #7c3aed)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <span style={{ color: "#fff", fontWeight: 800, fontSize: "0.85rem", fontFamily: "monospace" }}>
                {fields.position_number}
              </span>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "1rem" }}>
                {savedCam?.label || fields.label || formatCameraNumber(t, fields.position_number)}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 1 }}>
                {fields.ip_address || t.ipNotConfigured}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <ConnectionBadge
              status={headerStatus}
              checking={connectionChecking && !connectionStatus}
              t={t}
            />
            {!isNew && (
              <button
                type="button"
                className="btn btn-secondary btn-icon"
                onClick={handleDelete}
                disabled={deleting}
                style={{ borderRadius: "50%", color: "#ef4444", borderColor: "rgba(239,68,68,0.3)" }}
                title={t.deleteCamera}
              >
                {deleting ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={14} />}
              </button>
            )}
            <button className="btn btn-secondary btn-icon" onClick={onClose} style={{ borderRadius: "50%" }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", borderBottom: "1px solid var(--border-color)",
          padding: "0 1.25rem", background: "var(--bg-secondary)"
        }}>
          {[
            { key: "view", icon: <Eye size={13} />, label: t.liveVideoTab, disabled: isNew || !fields.ip_address },
            { key: "settings", icon: <Settings size={13} />, label: isNew ? t.addCameraTab : t.editCameraTab },
          ].map(tb => (
            <button
              key={tb.key}
              type="button"
              onClick={() => !tb.disabled && setTab(tb.key)}
              disabled={tb.disabled}
              style={{
                display: "flex", alignItems: "center", gap: "0.35rem",
                padding: "0.75rem 1rem",
                background: "none", border: "none", cursor: tb.disabled ? "not-allowed" : "pointer",
                fontSize: "0.82rem", fontWeight: 600,
                color: tb.disabled ? "var(--text-muted)" : tab === tb.key ? "var(--accent-color)" : "var(--text-secondary)",
                borderBottom: `2px solid ${tab === tb.key && !tb.disabled ? "var(--accent-color)" : "transparent"}`,
                marginBottom: -1, transition: "all 0.15s",
                opacity: tb.disabled ? 0.5 : 1,
              }}
            >
              {tb.icon} {tb.label}
            </button>
          ))}
        </div>

        {/* VIEW TAB */}
        {tab === "view" && !isNew && (
          <div className="modal-body" style={{ padding: "1.25rem" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {connectionChecking && (
                <div style={{
                  display: "flex", alignItems: "center", gap: "0.6rem",
                  padding: "0.75rem", borderRadius: "0.5rem",
                  background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)",
                  fontSize: "0.8rem", color: "var(--text-secondary)",
                }}>
                  <Loader size={16} style={{ animation: "spin 1s linear infinite", color: "#3b82f6" }} />
                  {t.checkingConnection}
                </div>
              )}

              {/* Real-time snapshot */}
              <div style={{
                position: "relative",
                borderRadius: "0.75rem",
                overflow: "hidden",
                background: "#090d16",
                aspectRatio: "16/9",
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "1px solid var(--border-color)",
                boxShadow: "inset 0 0 20px rgba(0,0,0,0.6)"
              }}>
                {initialLoading && streamAllowed && !connectionChecking && (
                  <div style={{
                    position: "absolute", inset: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexDirection: "column", gap: "0.6rem",
                    color: "var(--text-muted)", background: "#090d16", zIndex: 5
                  }}>
                    <Loader size={28} style={{ animation: "spin 1s linear infinite", color: "var(--accent-color)" }} />
                    <span style={{ fontSize: "0.78rem", fontWeight: 500 }}>{t.streamConnecting}</span>
                  </div>
                )}

                {!imgError && streamAllowed && !connectionChecking && (
                  <img
                    src={liveUrl}
                    alt="Live feed"
                    style={{
                      width: "100%", height: "100%", objectFit: "cover",
                      display: initialLoading ? "none" : "block", cursor: "zoom-in",
                    }}
                    onClick={() => setLiveZoomed(true)}
                    title={t.enlargeToView}
                    onLoad={() => { setInitialLoading(false); setImgError(false); }}
                    onError={() => { setImgError(true); setInitialLoading(false); }}
                  />
                )}

                {imgError && !connectionChecking && (
                  <div style={{
                    textAlign: "center", color: "var(--text-muted)",
                    padding: "1.5rem", width: "100%", height: "100%",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center"
                  }}>
                    <WifiOff size={32} style={{ color: "#ef4444", marginBottom: 6, opacity: 0.8 }} />
                    <ConnectionBadge status={connectionStatus?.status || "offline"} t={t} />
                    <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f8fafc", marginTop: 10 }}>
                      {backendErrorDetail || connectionStatus?.message || (directConnect ? t.streamViaBrowserFailed : t.streamViaServerFailed)}
                    </div>
                    <div style={{ fontSize: "0.75rem", marginTop: 4, opacity: 0.6 }}>
                      IP: {fields.ip_address}:{fields.http_port}
                    </div>
                    <button
                      type="button" className="btn btn-primary"
                      style={{ marginTop: 12, fontSize: "0.78rem", padding: "6px 12px", display: "flex", alignItems: "center", gap: 6, borderRadius: "0.375rem" }}
                      onClick={() => setTab("settings")}
                    >
                      <Settings size={13} /> {t.editConnectionSettings}
                    </button>
                  </div>
                )}

                {!imgError && !initialLoading && (
                  <>
                    <div style={{
                      position: "absolute", top: 12, left: 12,
                      background: "rgba(239, 68, 68, 0.85)", color: "#ffffff",
                      fontSize: "0.68rem", fontWeight: 800, padding: "3px 8px", borderRadius: 4,
                      display: "flex", alignItems: "center", gap: 5, zIndex: 4
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", animation: "pulse-dot 1.2s infinite" }} />
                      {t.streamLive}
                    </div>
                    <button
                      type="button"
                      onClick={() => setLiveZoomed(true)}
                      style={{
                        position: "absolute", bottom: 12, right: 12,
                        background: "rgba(15, 23, 42, 0.85)", border: "1px solid rgba(255,255,255,0.2)",
                        color: "#ffffff", padding: "6px 10px", borderRadius: 6,
                        display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                        fontSize: "0.72rem", fontWeight: 600, zIndex: 4,
                        backdropFilter: "blur(4px)"
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(37, 99, 235, 0.9)"}
                      onMouseLeave={e => e.currentTarget.style.background = "rgba(15, 23, 42, 0.85)"}
                    >
                      <ExternalLink size={12} /> {t.enlarge}
                    </button>
                  </>
                )}
              </div>

              {/* Mode toggle */}
              {IS_DESKTOP_MODE && localAgentAvailable && isLocalNetworkIp(fields.ip_address) ? (
                <div style={{
                  padding: "0.6rem 0.75rem", borderRadius: "0.5rem", fontSize: "0.75rem", fontWeight: 600,
                  background: "rgba(34, 197, 94, 0.1)", border: "1px solid rgba(34, 197, 94, 0.25)",
                  color: "var(--text-primary)",
                }}>
                  {t.connectViaLocalAgent}
                </div>
              ) : (
              <div style={{
                display: "flex", gap: "0.5rem", background: "var(--bg-tertiary)",
                padding: "3px", borderRadius: "0.5rem", border: "1px solid var(--border-color)"
              }}>
                <button type="button" onClick={() => setDirectConnect(false)} style={{
                  flex: 1, padding: "6px", fontSize: "0.75rem", fontWeight: 600,
                  borderRadius: "0.35rem", border: "none", cursor: "pointer",
                  background: !directConnect ? "var(--bg-primary)" : "transparent",
                  color: !directConnect ? "var(--accent-color)" : "var(--text-secondary)",
                  boxShadow: !directConnect ? "0 1px 3px rgba(0,0,0,0.2)" : "none", transition: "all 0.15s"
                }}>{IS_DESKTOP_MODE ? t.connectViaLocalAgent : t.connectViaServer}</button>
                <button type="button" onClick={() => setDirectConnect(true)} style={{
                  flex: 1, padding: "6px", fontSize: "0.75rem", fontWeight: 600,
                  borderRadius: "0.35rem", border: "none", cursor: "pointer",
                  background: directConnect ? "var(--bg-primary)" : "transparent",
                  color: directConnect ? "var(--accent-color)" : "var(--text-secondary)",
                  boxShadow: directConnect ? "0 1px 3px rgba(0,0,0,0.2)" : "none", transition: "all 0.15s"
                }}>{t.connectViaBrowser}</button>
              </div>
              )}

              {directConnect && !(IS_DESKTOP_MODE && localAgentAvailable && isLocalNetworkIp(fields.ip_address)) && (
                <div style={{
                  padding: "0.75rem", borderRadius: "0.5rem",
                  background: "rgba(37, 99, 235, 0.05)", border: "1px solid rgba(37, 99, 235, 0.15)",
                  display: "flex", flexDirection: "column", gap: "0.5rem"
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>{t.snapshotUrl}</span>
                    <select value={directPath} onChange={e => setDirectPath(e.target.value)} style={{
                      background: "var(--bg-primary)", color: "var(--text-primary)",
                      border: "1px solid var(--border-color)", borderRadius: 4,
                      padding: "2px 6px", fontSize: "0.75rem"
                    }}>
                      <option value="/cgi-bin/snapshot.cgi">Dahua</option>
                      <option value="/ISAPI/Streaming/channels/101/picture">Hikvision (ISAPI)</option>
                      <option value="/snapshot.jpg">Generic</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Connection info */}
              <div style={{
                background: "var(--bg-tertiary)", borderRadius: "0.5rem",
                padding: "0.75rem", border: "1px solid var(--border-color)", fontSize: "0.78rem"
              }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                  <div>
                    <span style={{ color: "var(--text-muted)", display: "block", fontSize: "0.7rem", textTransform: "uppercase" }}>{t.cameraIp}</span>
                    <strong style={{ color: "var(--text-primary)" }}>{fields.ip_address}:{fields.http_port}</strong>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-muted)", display: "block", fontSize: "0.7rem", textTransform: "uppercase" }}>{t.positionNumberLabel}</span>
                    <strong style={{ color: "var(--text-primary)" }}>#{fields.position_number}</strong>
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1, fontSize: "0.8rem", padding: "0.5rem" }} onClick={handleCopyRtsp}>
                  {copied ? <CircleCheck size={14} style={{ color: "#10b981" }} /> : <Copy size={14} />}
                  {copied ? t.rtspCopied : t.copyRtspUrl}
                </button>
                <button type="button" className="btn btn-secondary" style={{ fontSize: "0.8rem", padding: "0.5rem" }} onClick={async () => {
                  const result = await runConnectionTest();
                  if (result.ok) {
                    setStreamAllowed(true);
                    setImgError(false);
                    setInitialLoading(true);
                  } else {
                    setStreamAllowed(false);
                    setImgError(true);
                    setBackendErrorDetail(result.message);
                  }
                }}>
                  <RotateCcw size={14} /> {t.recheckConnection}
                </button>
                <button type="button" className="btn btn-secondary" style={{ fontSize: "0.8rem", padding: "0.5rem" }} onClick={() => window.open(`http://${fields.ip_address}:${fields.http_port}`, "_blank")}>
                  <ExternalLink size={14} /> {t.openInBrowser}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SETTINGS TAB */}
        {tab === "settings" && (
          <form onSubmit={handleSave}>
            <div className="modal-body" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

              {/* Joy raqami */}
              <div className="form-group">
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600 }}>
                  <Hash size={13} style={{ color: "var(--accent-color)" }} />
                  {t.positionNumberLabel} <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="1"
                  value={fields.position_number}
                  onChange={e => handleChange("position_number", e.target.value)}
                  required
                  min={1}
                  style={{ borderRadius: "0.5rem" }}
                />
              </div>

              {/* IP Manzil */}
              <div className="form-group">
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600 }}>
                  <Globe2 size={13} strokeWidth={1.75} style={{ color: "var(--accent-color)" }} />
                  {t.cameraIp} <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder={t.ipExample}
                  value={fields.ip_address}
                  onChange={e => handleChange("ip_address", e.target.value)}
                  required
                  style={{ borderRadius: "0.5rem" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div className="form-group">
                  <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600 }}>
                    <CircleUser size={13} strokeWidth={1.75} style={{ color: "var(--accent-color)" }} />
                    {t.cameraLogin}
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="admin"
                    value={fields.login}
                    onChange={e => handleChange("login", e.target.value)}
                    style={{ borderRadius: "0.5rem" }}
                  />
                </div>
                <div className="form-group">
                  <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600 }}>
                    <LockKeyhole size={13} strokeWidth={1.75} style={{ color: "var(--accent-color)" }} />
                    {t.cameraPassword} <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder={t.password}
                    value={fields.password}
                    onChange={e => handleChange("password", e.target.value)}
                    required
                    style={{ borderRadius: "0.5rem" }}
                  />
                </div>
              </div>

              {connectionStatus && !connectionStatus.ok && tab === "settings" && (
                <div style={{
                  padding: "0.75rem", borderRadius: "0.5rem",
                  background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
                  fontSize: "0.8rem", color: "#fca5a5",
                }}>
                  <strong style={{ color: "#ef4444" }}>{t.connectionErrorLabel}</strong> {connectionStatus.message}
                </div>
              )}

              {/* Advanced */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.3rem",
                    background: "none", border: "none", color: "var(--text-muted)",
                    fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", padding: "0.25rem 0"
                  }}
                >
                  {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  {t.advancedSettings}
                </button>

                {showAdvanced && (
                  <div style={{
                    marginTop: "0.5rem", padding: "0.85rem", borderRadius: "0.75rem",
                    background: "var(--bg-tertiary)", border: "1px solid var(--border-color)",
                    display: "flex", flexDirection: "column", gap: "0.75rem",
                    animation: "fadeIn 0.2s ease"
                  }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                      <div className="form-group">
                        <label style={{ fontSize: "0.75rem" }}>{t.rtspPort}</label>
                        <input type="number" className="form-input" value={fields.rtsp_port} onChange={e => handleChange("rtsp_port", e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label style={{ fontSize: "0.75rem" }}>{t.httpPort}</label>
                        <input type="number" className="form-input" value={fields.http_port} onChange={e => handleChange("http_port", e.target.value)} />
                      </div>
                    </div>

                    <div className="form-group">
                      <label style={{ fontSize: "0.75rem" }}>{t.streamPath}</label>
                      <input
                        type="text" className="form-input" placeholder="/Streaming/Channels/101"
                        value={fields.stream_path} onChange={e => handleChange("stream_path", e.target.value)}
                      />
                    </div>

                    <div className="form-group">
                      <label style={{ fontSize: "0.75rem" }}>{t.cameraLabel}</label>
                      <input
                        type="text" className="form-input" placeholder={t.labelExample}
                        value={fields.label} onChange={e => handleChange("label", e.target.value)}
                      />
                    </div>

                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600 }}>
                      <input
                        type="checkbox" checked={fields.is_active}
                        onChange={e => handleChange("is_active", e.target.checked)}
                      />
                      {t.connectionActive}
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer" style={{ padding: "1rem 1.25rem", background: "var(--bg-secondary)", display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-secondary" onClick={onClose} style={{ borderRadius: "0.5rem" }}>
                {t.cancel}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={connectionChecking || !fields.ip_address}
                onClick={() => runConnectionTest()}
                style={{ borderRadius: "0.5rem", display: "flex", alignItems: "center", gap: 6 }}
              >
                {connectionChecking ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Wifi size={14} />}
                {t.testConnection}
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving || connectionChecking} style={{ borderRadius: "0.5rem" }}>
                {saving ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={14} />}
                {isNew ? t.addBtn : t.save}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* LIVE ZOOM */}
      {liveZoomed && streamAllowed && (
        <InteractiveMediaViewer
          src={liveUrl}
          title={`${savedCam?.label || formatCameraNumber(t, savedCam?.position_number)} — ${t.liveViewTitle}`}
          onClose={() => setLiveZoomed(false)}
          isLive={true}
          t={t}
        />
      )}
    </div>

    {showDeleteConfirm && createPortal(
      <div className="confirm-overlay" onClick={() => !deleting && setShowDeleteConfirm(false)}>
        <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
          <div className="confirm-icon-ring danger">
            <Trash2 size={26} strokeWidth={1.75} />
          </div>
          <h3 className="confirm-title">{t.deleteConfirmTitle}</h3>
          <p className="confirm-message">
            <strong>{cam?.label || formatCameraNumber(t, cam?.position_number)}</strong> {t.deleteConfirmMsg}
            {t.deleteIrreversible}
          </p>
          <div className="confirm-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={deleting}
            >
              {t.cancel}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={executeDelete}
              disabled={deleting}
              style={{ minWidth: 110 }}
            >
              {deleting ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={14} />}
              {t.deleteBtn}
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}


// ─── RASM YUKLASH MODAL ─────────────────────────────────────────────────
function ImageUploadModal({ station, token, t, onClose, onUploaded, showNotification }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileSelect = (file) => {
    if (!file) return;
    const allowed = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
    if (!allowed.includes(file.type)) {
      showNotification("warning", t.errorTitle, t.invalidFileType);
      return;
    }
    setSelectedFile(file);
    if (file.type !== "application/pdf") {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target.result);
      reader.readAsDataURL(file);
    } else {
      setPreview("pdf");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFileSelect(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("schema_image", selectedFile);
      const resp = await fetch(`${API_BASE_URL}/api/stations/${station.id}/upload-image/`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!resp.ok) throw new Error(t.uploadError);
      showNotification("success", t.successTitle, t.uploadSuccess);
      onUploaded();
      onClose();
    } catch (err) {
      showNotification("error", t.errorTitle, err.message || t.uploadProblem);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content animate-scale-in"
        style={{ maxWidth: 500, width: "95vw", borderRadius: "1rem", overflow: "hidden" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header" style={{ padding: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: "linear-gradient(135deg, #f59e0b, #d97706)",
              display: "flex", alignItems: "center", justifyContent: "center"
            }}>
              <ImageIcon size={16} color="#fff" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "1rem" }}>
                {station?.schema_image ? t.updateSchema : t.uploadSchema}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 1 }}>
                {station?.name} — {t.schemaFormats}
              </div>
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-icon" onClick={onClose} style={{ borderRadius: "50%" }}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: "1.25rem" }}>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? "var(--accent-color)" : selectedFile ? "#10b981" : "var(--border-color)"}`,
              borderRadius: "0.75rem", padding: "2rem", textAlign: "center", cursor: "pointer",
              background: dragOver ? "rgba(37,99,235,0.05)" : selectedFile ? "rgba(16,185,129,0.05)" : "var(--bg-tertiary)",
              transition: "all 0.2s ease",
            }}
          >
            <input
              ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.pdf"
              style={{ display: "none" }}
              onChange={e => handleFileSelect(e.target.files[0])}
            />
            {preview && preview !== "pdf" ? (
              <div>
                <img src={preview} alt="Preview" style={{ maxHeight: 220, maxWidth: "100%", borderRadius: "0.5rem", objectFit: "contain", marginBottom: "0.75rem" }} />
                <div style={{ fontSize: "0.8rem", color: "#10b981", fontWeight: 600 }}>✓ {selectedFile.name}</div>
              </div>
            ) : preview === "pdf" ? (
              <div>
                <FileImage size={48} style={{ color: "#f59e0b", marginBottom: "0.75rem" }} />
                <div style={{ fontSize: "0.8rem", color: "#10b981", fontWeight: 600 }}>✓ {selectedFile.name}</div>
              </div>
            ) : (
              <div>
                <Upload size={40} style={{ color: "var(--text-muted)", opacity: 0.5, marginBottom: "0.75rem" }} />
                <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-primary)" }}>{t.dropFileHere}</div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>{t.fileSizeHint}</div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer" style={{ padding: "1rem 1.25rem", background: "var(--bg-secondary)" }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} style={{ borderRadius: "0.5rem" }}>{t.cancel}</button>
          <button
            type="button" className="btn btn-primary"
            disabled={!selectedFile || uploading} onClick={handleUpload}
            style={{ borderRadius: "0.5rem", background: "linear-gradient(135deg, #f59e0b, #d97706)", opacity: !selectedFile ? 0.6 : 1 }}
          >
            {uploading ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Upload size={14} />}
            {uploading ? t.uploading : t.uploadBtn}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── JONLI KAMERA FULLSCREEN ─────────────────────────────────────────────
function SchemaLiveViewer({ cam, token, t, onClose }) {
  const [tick, setTick] = useState(0);
  const [connection, setConnection] = useState({ checking: true });
  const [localAgentAvailable, setLocalAgentAvailable] = useState(false);

  useEffect(() => {
    if (!IS_DESKTOP_MODE) return;
    isLocalAgentAvailable().then(setLocalAgentAvailable);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const agentOk = IS_DESKTOP_MODE && (await isLocalAgentAvailable(true));
      if (!cancelled) setLocalAgentAvailable(agentOk);
      const result = await testSchemaCameraConnection(
        token,
        { id: cam.id, ip_address: cam.ip_address },
        t,
        agentOk
      );
      if (!cancelled) setConnection({ checking: false, ...result });
    })();
    return () => { cancelled = true; };
  }, [cam.id, cam.ip_address, token, t]);

  useEffect(() => {
    const canStream = connection.ok || connection.status === "local_only";
    if (!canStream) return;
    const interval = setInterval(() => setTick((prev) => prev + 1), 800);
    return () => clearInterval(interval);
  }, [connection.ok, connection.status, cam?.id]);

  if (!cam?.id) return null;

  const canStream = connection.ok || connection.status === "local_only";

  if (connection.checking) {
    return createPortal(
      <div style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.92)", display: "flex",
        alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12,
      }}>
        <Loader size={36} style={{ animation: "spin 1s linear infinite", color: "#3b82f6" }} />
        <span style={{ color: "#fff", fontSize: "0.9rem" }}>{t.checkingConnection}</span>
      </div>,
      document.body
    );
  }

  if (!canStream) {
    return createPortal(
      <div style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.92)", display: "flex",
        alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12,
      }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            position: "absolute", top: 18, right: 18,
            width: 44, height: 44, borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(31,41,55,0.88)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}
        >
          <X size={20} />
        </button>
        <WifiOff size={40} style={{ color: "#ef4444" }} />
        <ConnectionBadge status={connection.status || "offline"} t={t} />
        <p style={{ color: "#f8fafc", fontSize: "0.95rem", fontWeight: 600, maxWidth: 420, textAlign: "center", margin: 0 }}>
          {connection.message}
        </p>
      </div>,
      document.body
    );
  }

  const streamMode = resolveStreamMode({
    ip: cam.ip_address,
    localAgentAvailable,
    connectionStatus: connection,
    isLocalOnly: cam.is_local_only,
  });
  const liveUrl = getSchemaLiveUrl({
    camId: cam.id,
    fields: cam,
    token,
    mode: streamMode,
    tick,
  }) || `${API_BASE_URL}/api/schema-cameras/${cam.id}/live/?token=${token}&t=${tick}`;

  return (
    <InteractiveMediaViewer
      src={liveUrl}
      title={`${cam.label || formatCameraNumber(t, cam.position_number)} — ${t.liveViewTitle}`}
      onClose={onClose}
      isLive={true}
      t={t}
    />
  );
}

// ─── INTERACTIVE MEDIA VIEWER COMPONENT (ZOOM & PAN) ─────────────────────────
function InteractiveMediaViewer({ src, title, onClose, isLive, t }) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const mediaRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleWheel = (e) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const zoomFactor = 1.15;
    let newScale = e.deltaY < 0 ? scale * zoomFactor : scale / zoomFactor;
    newScale = Math.max(1, Math.min(newScale, 10));
    if (newScale === 1) { setPosition({ x: 0, y: 0 }); setScale(1); return; }
    const imageX = (mouseX - position.x) / scale;
    const imageY = (mouseY - position.y) / scale;
    setScale(newScale);
    setPosition({ x: mouseX - imageX * newScale, y: mouseY - imageY * newScale });
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleDoubleClick = (e) => {
    if (scale > 1) { setScale(1); setPosition({ x: 0, y: 0 }); }
    else {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const newScale = 3;
      const imageX = mouseX / scale;
      const imageY = mouseY / scale;
      setScale(newScale);
      setPosition({ x: mouseX - imageX * newScale, y: mouseY - imageY * newScale });
    }
  };

  const zoomIn = () => setScale(prev => Math.min(prev * 1.3, 10));
  const zoomOut = () => setScale(prev => { const next = Math.max(prev / 1.3, 1); if (next === 1) setPosition({ x: 0, y: 0 }); return next; });
  const resetZoom = () => { setScale(1); setPosition({ x: 0, y: 0 }); };

  const [touchStartDist, setTouchStartDist] = useState(0);
  const [touchStartScale, setTouchStartScale] = useState(1);

  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({ x: e.touches[0].clientX - position.x, y: e.touches[0].clientY - position.y });
    } else if (e.touches.length === 2) {
      setIsDragging(false);
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      setTouchStartDist(dist);
      setTouchStartScale(scale);
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 1 && isDragging) {
      setPosition({ x: e.touches[0].clientX - dragStart.x, y: e.touches[0].clientY - dragStart.y });
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const factor = dist / touchStartDist;
      let newScale = Math.max(1, Math.min(touchStartScale * factor, 10));
      setScale(newScale);
      if (newScale === 1) setPosition({ x: 0, y: 0 });
    }
  };

  const handleTouchEnd = () => setIsDragging(false);

  return createPortal(
    <div
      className="modal-overlay"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      style={{
        alignItems: "center", justifyContent: "center",
        background: "rgba(3, 7, 18, 0.96)",
        zIndex: 2147483647, position: "fixed", inset: 0,
        display: "flex", userSelect: "none"
      }}
    >
      {/* Title */}
      <div style={{
        position: "absolute", top: 20, left: 20, color: "#fff", zIndex: 10,
        pointerEvents: "none", display: "flex", flexDirection: "column", gap: 4
      }}>
        <div style={{ fontWeight: 700, fontSize: "1.1rem", textShadow: "0 2px 4px rgba(0,0,0,0.8)" }}>{title}</div>
        {isLive && (
          <div style={{
            background: "rgba(239, 68, 68, 0.95)", color: "#ffffff", fontSize: "0.68rem", fontWeight: 800,
            padding: "2px 8px", borderRadius: 4, display: "inline-flex", alignItems: "center", gap: 5, alignSelf: "flex-start"
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", animation: "pulse-dot 1.2s infinite" }} />
            LIVE
          </div>
        )}
      </div>

      {/* Controls */}
      <div
        style={{ position: "absolute", top: 20, right: 20, display: "flex", gap: "0.75rem", zIndex: 10 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          display: "flex", background: "rgba(31, 41, 55, 0.85)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: "0.75rem", padding: "4px",
          backdropFilter: "blur(8px)", boxShadow: "0 4px 15px rgba(0,0,0,0.4)"
        }}>
          {[
            { icon: <ZoomIn size={18} strokeWidth={1.75} />, onClick: zoomIn, title: t.zoomIn },
            { icon: <span style={{ fontSize: "1.2rem", fontWeight: "bold", lineHeight: 0 }}>-</span>, onClick: zoomOut, title: t.zoomOut },
            { icon: <span style={{ fontSize: "0.75rem", fontWeight: 700 }}>1:1</span>, onClick: resetZoom, title: t.resetView },
          ].map((btn, i) => (
            <button key={i} type="button" onClick={btn.onClick} title={btn.title}
              style={{
                background: "none", border: "none", color: "#fff",
                width: 36, height: 36, borderRadius: "0.5rem",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", transition: "background 0.2s"
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
              onMouseLeave={e => e.currentTarget.style.background = "none"}
            >
              {btn.icon}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} title={t.close}
          style={{
            background: "rgba(31, 41, 55, 0.85)", border: "1px solid rgba(255, 255, 255, 0.15)",
            color: "#fff", width: 44, height: 44, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", transition: "all 0.2s", backdropFilter: "blur(8px)"
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.85)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.5)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(31,41,55,0.85)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
        >
          <X size={20} />
        </button>
      </div>

      {/* Main viewport */}
      <div
        ref={containerRef}
        style={{
          width: "100vw", height: "100vh", display: "flex",
          alignItems: "center", justifyContent: "center", overflow: "hidden",
          cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "zoom-in"
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={e => e.stopPropagation()}
      >
        <img
          ref={mediaRef}
          src={src}
          alt={title}
          style={{
            maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: "center center",
            transition: isDragging ? "none" : "transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1)",
            pointerEvents: "none", boxShadow: "0 10px 40px rgba(0,0,0,0.8)", borderRadius: "0.5rem"
          }}
        />
      </div>

      {/* Helper */}
      <div style={{
        position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)",
        color: "rgba(255, 255, 255, 0.5)", fontSize: "0.78rem",
        background: "rgba(15, 23, 42, 0.8)", padding: "6px 16px", borderRadius: "999px",
        backdropFilter: "blur(4px)", pointerEvents: "none", border: "1px solid rgba(255,255,255,0.08)"
      }}>
        {t.zoomHelper}
      </div>
    </div>,
    document.body
  );
}

// ─── URL HELPER ───────────────────────────────────────────────────────────────
function buildMediaUrl(path) {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = API_BASE_URL.replace(/\/$/, '');
  const rel = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rel}`;
}

function isPdfSource(src) {
  if (!src) return false;
  return src.split('?')[0].toLowerCase().endsWith('.pdf');
}

function clampPercent(value) {
  return parseFloat(Math.max(0, Math.min(100, value)).toFixed(2));
}

// ─── SXEMA CANVAS (ZOOM, PAN, PINLAR) ───────────────────────────────────
function SchemaMapCanvas({
  src,
  alt,
  cameras = [],
  selectedCamId = null,
  highlightedCamId = null,
  editMode = false,
  onCanvasClick,
  onPinClick,
  onPinPositionChange,
  fullscreen = false,
  onClose,
  title,
  maxHeight = 600,
  onSaveLayout,
  onCancelEdit,
  hasPendingChanges = false,
  savingLayout = false,
  markCamId = null,
  markingCamLabel = null,
  t,
}) {
  const viewportRef = useRef(null);
  const stageRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const panMovedRef = useRef(false);
  const pinDragRef = useRef(false);
  const [draggingCamId, setDraggingCamId] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [droppedCamId, setDroppedCamId] = useState(null);
  const isPdf = isPdfSource(src);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (editMode && onCancelEdit) onCancelEdit();
        else onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, onClose, editMode, onCancelEdit]);

  const clientToPercent = useCallback((clientX, clientY) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: clampPercent(((clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((clientY - rect.top) / rect.height) * 100),
    };
  }, []);

  const handleWheel = (e) => {
    e.preventDefault();
    if (!viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const zoomFactor = 1.12;
    let newScale = e.deltaY < 0 ? scale * zoomFactor : scale / zoomFactor;
    newScale = Math.max(0.5, Math.min(newScale, fullscreen ? 10 : 4));
    if (newScale <= 0.55) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
      return;
    }
    const imageX = (mouseX - position.x) / scale;
    const imageY = (mouseY - position.y) / scale;
    setScale(newScale);
    setPosition({ x: mouseX - imageX * newScale, y: mouseY - imageY * newScale });
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".camera-pin-hit")) return;
    setIsPanning(true);
    panMovedRef.current = false;
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e) => {
    if (!isPanning) return;
    panMovedRef.current = true;
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsPanning(false);

  const handleStageClick = (e) => {
    if (!editMode) return;
    if (pinDragRef.current || panMovedRef.current) return;
    if (e.target.closest(".camera-pin-hit")) return;
    const pct = clientToPercent(e.clientX, e.clientY);
    if (pct && onCanvasClick) onCanvasClick(pct, e);
  };

  const handlePinMouseDown = (e, cam) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    pinDragRef.current = false;

    const startX = e.clientX;
    const startY = e.clientY;
    let hasMoved = false;

    setDraggingCamId(cam.id);

    const onMove = (moveEvent) => {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 4) {
        hasMoved = true;
        pinDragRef.current = true;
      }
      if (!hasMoved) return;
      const pct = clientToPercent(moveEvent.clientX, moveEvent.clientY);
      if (!pct) return;
      setDragPreview({ camId: cam.id, x: pct.x, y: pct.y });
    };

    const onUp = (upEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);

      const pct = clientToPercent(upEvent.clientX, upEvent.clientY);
      setDraggingCamId(null);
      setDragPreview(null);

      if (hasMoved && pct) {
        if (editMode) {
          onPinPositionChange?.(cam, pct.x, pct.y);
        }
        setDroppedCamId(cam.id);
        setTimeout(() => setDroppedCamId(null), 700);
      }

      setTimeout(() => { pinDragRef.current = false; }, 50);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const getPinCam = (cam) => {
    if (dragPreview?.camId === cam.id) {
      return { ...cam, pos_x: dragPreview.x, pos_y: dragPreview.y };
    }
    return cam;
  };

  const zoomIn = () => setScale(prev => Math.min(prev * 1.2, fullscreen ? 10 : 4));
  const zoomOut = () => setScale(prev => {
    const next = Math.max(prev / 1.2, 0.5);
    if (next <= 0.55) { setPosition({ x: 0, y: 0 }); return 1; }
    return next;
  });
  const resetZoom = () => { setScale(1); setPosition({ x: 0, y: 0 }); };

  const canvasBody = (
    <>
      {fullscreen && title && (
        <div className="schema-fullscreen-title">
          <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>{title}</div>
          {editMode && (
            <div style={{ fontSize: "0.78rem", opacity: 0.75, marginTop: 2 }}>
              {t.editDragSaveHint}
            </div>
          )}
        </div>
      )}

      {editMode && fullscreen && (
        <div className="schema-edit-toolbar" onClick={e => e.stopPropagation()}>
          <span className="schema-edit-toolbar-label">
            <MapPin size={14} strokeWidth={1.75} /> {t.placementModeLabel}
          </span>
          <div className="schema-edit-toolbar-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onCancelEdit}
              disabled={savingLayout}
            >
              {t.layoutCancel}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onSaveLayout}
              disabled={savingLayout || !hasPendingChanges}
              style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}
            >
              {savingLayout ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={14} strokeWidth={1.75} />}
              {t.layoutSave}
            </button>
          </div>
        </div>
      )}

      {fullscreen && (
        <button
          type="button"
          className="schema-fullscreen-exit-btn"
          onClick={editMode ? onCancelEdit : onClose}
          title={t.close}
        >
          <X size={20} strokeWidth={1.75} />
        </button>
      )}

      <div className="schema-zoom-controls" onClick={e => e.stopPropagation()}>
        <button type="button" onClick={zoomIn} title={t.zoomIn}><ZoomIn size={16} strokeWidth={1.75} /></button>
        <button type="button" onClick={zoomOut} title={t.zoomOut}><span style={{ fontSize: "1.1rem", fontWeight: 700, lineHeight: 1 }}>−</span></button>
        <button type="button" onClick={resetZoom} title={t.resetZoom}><span style={{ fontSize: "0.68rem", fontWeight: 700 }}>1:1</span></button>
      </div>

      {editMode && markingCamLabel && (
        <div className="schema-placement-hint">
          <MapPin size={14} strokeWidth={1.75} />
          {markingCamLabel}
        </div>
      )}

      <div
        ref={viewportRef}
        className={`schema-viewport ${fullscreen ? "schema-viewport--fullscreen" : ""} ${editMode ? "schema-viewport--edit" : "schema-viewport--view"}`}
        style={!fullscreen ? { maxHeight } : undefined}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleStageClick}
      >
        <div
          className="schema-transform-layer"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isPanning ? "none" : "transform 0.12s ease-out",
          }}
        >
          <div className="schema-stage" ref={stageRef}>
            {isPdf ? (
              <object data={src} type="application/pdf" className="schema-media schema-media--pdf" aria-label={alt}>
                <iframe src={src} className="schema-media schema-media--pdf" title={alt} />
              </object>
            ) : (
              <img src={src} alt={alt} className="schema-media" draggable={false} />
            )}
            {cameras.map((cam) => (
              <div
                key={cam.id}
                className={`camera-pin-hit ${editMode ? "camera-pin-hit--edit" : "camera-pin-hit--view"}`}
                style={{
                  position: "absolute",
                  left: `${getPinCam(cam).pos_x}%`,
                  top: `${getPinCam(cam).pos_y}%`,
                  transform: "translate(-50%, -50%)",
                  zIndex: draggingCamId === cam.id ? 40 : selectedCamId === cam.id || highlightedCamId === cam.id ? 30 : 10,
                }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  handlePinMouseDown(e, cam);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (editMode || pinDragRef.current || draggingCamId) return;
                  onPinClick?.(cam);
                }}
              >
                <CameraPin
                  cam={getPinCam(cam)}
                  selected={selectedCamId === cam.id}
                  highlighted={highlightedCamId === cam.id}
                  isDragging={draggingCamId === cam.id}
                  justDropped={droppedCamId === cam.id}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="schema-viewport-hint">
        {editMode
          ? t.pinHintEdit
          : fullscreen
            ? t.pinHintFullscreen
            : t.pinHintView}
      </div>
    </>
  );

  if (fullscreen) {
    return createPortal(
      <div className="schema-fullscreen-overlay" onClick={editMode ? undefined : onClose}>
        <div className="schema-fullscreen-inner" onClick={e => e.stopPropagation()}>
          <div className="schema-canvas-wrap schema-canvas-wrap--fullscreen">
            {canvasBody}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return <div className="schema-canvas-wrap">{canvasBody}</div>;
}

// ─── MAIN CAMERA SCHEMA COMPONENT ─────────────────────────────────────────────
export default function CameraSchema({ station, token, t, showNotification, onRefresh }) {
  // Schema cameras — BUTUNLAY MUSTAQIL Camera modelidan
  const [schemaCameras, setSchemaCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCam, setSelectedCam] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInitialTab, setModalInitialTab] = useState("view");
  const [clickedCoordinates, setClickedCoordinates] = useState(null);

  const [imageUploadOpen, setImageUploadOpen] = useState(false);
  const [fullscreenMode, setFullscreenMode] = useState(null); // null | 'view' | 'edit'
  const [pendingPositions, setPendingPositions] = useState({});
  const [savingLayout, setSavingLayout] = useState(false);
  const [highlightedCamId, setHighlightedCamId] = useState(null);
  const [markCamId, setMarkCamId] = useState(null);
  const [liveFullscreenCam, setLiveFullscreenCam] = useState(null);
  const [connectionMap, setConnectionMap] = useState({});

  const testAllCameraConnections = useCallback(async (cameras) => {
    if (!cameras.length) {
      setConnectionMap({});
      return;
    }
    const checking = {};
    cameras.forEach((c) => {
      checking[c.id] = { ok: null, status: "checking", message: "" };
    });
    setConnectionMap((prev) => ({ ...prev, ...checking }));

    const agentOk = IS_DESKTOP_MODE ? await isLocalAgentAvailable(true) : false;
    cameras.forEach((cam) => {
      const opts = getConnectionTestOptions(cam.ip_address);
      testSchemaCameraConnection(
        token,
        { id: cam.id, ip_address: cam.ip_address },
        t,
        opts.viaAgent && agentOk,
        { quick: opts.quick, timeoutMs: opts.timeoutMs }
      )
        .then((result) => {
          setConnectionMap((prev) => ({ ...prev, [cam.id]: result }));
        })
        .catch(() => {
          setConnectionMap((prev) => ({
            ...prev,
            [cam.id]: localizeConnectionResult(t, { ok: false, status: "error", message: t.connServerError }),
          }));
        });
    });
  }, [token, t]);

  const fetchSchemaCameras = useCallback(async () => {
    if (!station?.id) return;
    setLoading(true);
    try {
      const resp = await fetch(
        `${API_BASE_URL}/api/schema-cameras/?station=${station.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) throw new Error();
      const data = await resp.json();
      const list = Array.isArray(data) ? data : data.results || [];
      setSchemaCameras(list);
      setLoading(false);
      testAllCameraConnections(list);
    } catch {
      setSchemaCameras([]);
      setLoading(false);
    }
  }, [station?.id, token, testAllCameraConnections]);

  useEffect(() => {
    fetchSchemaCameras();
  }, [fetchSchemaCameras]);

  const openCameraModal = (cam, tab = "view") => {
    setSelectedCam(cam);
    setClickedCoordinates(null);
    setModalInitialTab(tab);
    setModalOpen(true);
  };

  const handlePinClick = (cam) => {
    const conn = connectionMap[cam.id];
    const canLive = conn?.ok === true || conn?.status === "local_only";
    if (conn?.ok === false && conn?.status !== "local_only") {
      showNotification("warning", t.liveNoVideo, conn.message);
      openCameraModal(cam, "view");
      return;
    }
    if (!canLive) {
      showNotification("info", t.checkingTitle, t.checkingWait);
      return;
    }
    if (fullscreenMode === "view") {
      setFullscreenMode(null);
      setLiveFullscreenCam(cam);
      return;
    }
    openCameraModal(cam, "view");
  };

  const handleAddNew = () => {
    setSelectedCam(null);
    setClickedCoordinates(null);
    setModalInitialTab("settings");
    setModalOpen(true);
  };

  const camerasForCanvas = schemaCameras.map((cam) => {
    const conn = connectionMap[cam.id];
    const base = {
      ...cam,
      connection_ok: conn?.ok ?? null,
      connection_status: conn?.status,
      connection_message: conn?.message,
    };
    const pending = pendingPositions[cam.id];
    if (pending) return { ...base, pos_x: pending.pos_x, pos_y: pending.pos_y };
    return base;
  });

  const hasPendingChanges = Object.keys(pendingPositions).length > 0;

  const handlePinPositionChange = (cam, x, y) => {
    setPendingPositions((prev) => ({
      ...prev,
      [cam.id]: { pos_x: x, pos_y: y },
    }));
  };

  const handleEditSchemaClick = (coords) => {
    if (markCamId) {
      const cam = schemaCameras.find((c) => c.id === markCamId);
      if (cam) handlePinPositionChange(cam, coords.x, coords.y);
      setMarkCamId(null);
      return;
    }
    setSelectedCam(null);
    setClickedCoordinates(coords);
    setModalInitialTab("settings");
    setModalOpen(true);
  };

  const handleSaveLayout = async () => {
    const entries = Object.entries(pendingPositions);
    if (!entries.length) return;
    setSavingLayout(true);
    try {
      await Promise.all(
        entries.map(([id, pos]) =>
          fetch(`${API_BASE_URL}/api/schema-cameras/${id}/`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ pos_x: pos.pos_x, pos_y: pos.pos_y }),
          })
        )
      );
      showNotification("success", t.title, t.successSaved);
      setPendingPositions({});
      setFullscreenMode(null);
      await fetchSchemaCameras();
    } catch (err) {
      console.error("Failed to save layout", err);
      showNotification("error", t.title, t.errorSaving || "Saqlashda xatolik");
    } finally {
      setSavingLayout(false);
    }
  };

  const handleCancelEdit = () => {
    setPendingPositions({});
    setMarkCamId(null);
    setFullscreenMode(null);
  };

  const openLayoutEditor = () => {
    setPendingPositions({});
    setMarkCamId(null);
    setFullscreenMode("edit");
  };

  const handleSaved = async (data, connectionResult) => {
    if (data === null) {
      showNotification("success", t.title, t.cameraDeleted);
    } else if (connectionResult?.ok) {
      showNotification("success", t.title, t.cameraSavedLiveMsg);
    } else if (connectionResult?.status === "local_only") {
      showNotification("success", t.title, t.connMsgLocalOnly);
    } else if (connectionResult?.status === "offline") {
      showNotification("warning", t.title, t.cameraSavedOfflineMsg);
    } else if (connectionResult) {
      showNotification("warning", t.connectionErrorTitle, connectionResult.message);
    } else {
      showNotification("success", t.title, t.successStreamSaved || "Saqlandi");
    }
    if (data?.id && connectionResult) {
      setConnectionMap((prev) => ({ ...prev, [data.id]: connectionResult }));
    }
    await fetchSchemaCameras();
    if (onRefresh) onRefresh();
  };

  const handleImageUploaded = async () => {
    if (onRefresh) onRefresh();
  };

  // Next available position number
  const nextPositionNumber = schemaCameras.length > 0
    ? Math.max(...schemaCameras.map(c => c.position_number)) + 1
    : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

      {/* ─── STATION SCHEMATIC PLAN ─── */}
      <div className="card" style={{ padding: 0, overflow: "hidden", borderRadius: "0.75rem" }}>

        {/* Card Header */}
        <div style={{
          padding: "1rem 1.25rem",
          borderBottom: "1px solid var(--border-color)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: "var(--bg-secondary)", flexWrap: "wrap", gap: "0.5rem"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <MapPin size={16} style={{ color: "var(--accent-color)" }} />
            <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>{t.cameraSchema}</span>
            <span style={{
              fontSize: "0.72rem", fontWeight: 600, padding: "2px 8px", borderRadius: 999,
              background: "var(--bg-tertiary)", color: "var(--text-muted)", border: "1px solid var(--border-color)"
            }}>
              {schemaCameras.length} {t.camerasUnit}
            </span>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            {station?.schema_image && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: "0.75rem", padding: "0.4rem 0.8rem", display: "flex", alignItems: "center", gap: "0.35rem" }}
                  onClick={() => setFullscreenMode("view")}
                >
                  <Eye size={13} /> {t.enlarge}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{
                    fontSize: "0.75rem",
                    padding: "0.4rem 0.8rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
                  }}
                  onClick={openLayoutEditor}
                >
                  <MapPin size={13} /> {t.placement}
                </button>
              </>
            )}
            <button
              type="button" className="btn btn-secondary"
              style={{ fontSize: "0.75rem", padding: "0.4rem 0.8rem", display: "flex", alignItems: "center", gap: "0.35rem" }}
              onClick={() => setImageUploadOpen(true)}
            >
              {station?.schema_image
                ? <><RefreshCw size={13} /> {t.reupload}</>
                : <><Upload size={13} /> {t.uploadSchemaShort}</>
              }
            </button>
          </div>
        </div>

        {/* ─── Image Display Area with Camera Pins ─── */}
        <div style={{ position: "relative", width: "100%", background: "var(--bg-tertiary)" }}>
          {station?.schema_image ? (
            <SchemaMapCanvas
              src={buildMediaUrl(station.schema_image)}
              alt={`${station.name} ${t.schemaOf}`}
              cameras={camerasForCanvas}
              selectedCamId={selectedCam?.id}
              highlightedCamId={highlightedCamId}
              editMode={false}
              onPinClick={handlePinClick}
              maxHeight={600}
              t={t}
            />
          ) : (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              minHeight: 300, gap: "1rem", color: "var(--text-muted)", width: "100%"
            }}>
              <div style={{
                width: 80, height: 80, borderRadius: "50%",
                background: "var(--bg-secondary)", display: "flex", alignItems: "center", justifyContent: "center",
                border: "2px dashed var(--border-color)"
              }}>
                <MapPin size={36} style={{ opacity: 0.25 }} />
              </div>
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text-secondary)" }}>{t.noSchema}</p>
                <p style={{ fontSize: "0.78rem", opacity: 0.6, marginTop: "0.25rem" }}>
                  {t.uploadSchemaHint}
                </p>
              </div>
              <button
                type="button" className="btn btn-primary"
                style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem" }}
                onClick={(e) => { e.stopPropagation(); setImageUploadOpen(true); }}
              >
                <Upload size={15} /> {t.uploadSchemaBtn}
              </button>
            </div>
          )}
        </div>

      </div>

      {/* ─── SCHEMA CAMERA TABLE ─── */}
      <div className="card" style={{ padding: 0, overflow: "hidden", borderRadius: "0.75rem" }}>
        <div style={{
          padding: "1rem 1.25rem",
          borderBottom: "1px solid var(--border-color)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: "var(--bg-secondary)", flexWrap: "wrap", gap: "0.5rem"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Cctv size={16} style={{ color: "var(--accent-color)" }} />
            <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>
              {t.schemaCamerasList} ({schemaCameras.length})
            </span>
          </div>
          <button
            type="button" className="btn btn-primary"
            style={{
              fontSize: "0.8rem", padding: "0.45rem 1rem",
              display: "flex", alignItems: "center", gap: "0.4rem",
              background: "linear-gradient(135deg, #10b981, #059669)", borderRadius: "0.5rem",
            }}
            onClick={handleAddNew}
          >
            <CirclePlus size={14} strokeWidth={1.75} /> {t.addCameraBtn}
          </button>
        </div>

        {loading ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
            <Loader size={28} style={{ animation: "spin 1s linear infinite", color: "var(--accent-color)", marginBottom: 8 }} />
            <p>{t.loading}</p>
          </div>
        ) : schemaCameras.length === 0 ? (
          <div style={{
            padding: "3rem", textAlign: "center", color: "var(--text-muted)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem"
          }}>
            <Cctv size={40} style={{ opacity: 0.2 }} />
            <div>
              <p style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-secondary)" }}>
                {t.noData}
              </p>
              <p style={{ fontSize: "0.78rem", opacity: 0.6, marginTop: "0.25rem" }}>
                {t.addToSchemaHint}
              </p>
            </div>
            <button
              type="button" className="btn btn-primary"
              style={{
                display: "flex", alignItems: "center", gap: "0.4rem",
                background: "linear-gradient(135deg, #10b981, #059669)",
              }}
              onClick={handleAddNew}
            >
              <CirclePlus size={14} strokeWidth={1.75} /> {t.firstCamera}
            </button>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border-color)", background: "var(--bg-tertiary)" }}>
                  <th style={{ padding: "0.85rem 1.25rem", fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 700, width: "70px" }}>{t.positionNumber}</th>
                  <th style={{ padding: "0.85rem 1.25rem", fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 700 }}>{t.cameraCol}</th>
                  <th style={{ padding: "0.85rem 1.25rem", fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 700 }}>{t.cameraIp}</th>
                  <th style={{ padding: "0.85rem 1.25rem", fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 700 }}>{t.statusCol}</th>
                  <th style={{ padding: "0.85rem 1.25rem", fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 700, textAlign: "right", width: "130px" }}>{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {[...schemaCameras].sort((a, b) => a.position_number - b.position_number).map((cam) => (
                  <tr
                    key={cam.id}
                    style={{
                      borderBottom: "1px solid var(--border-color)",
                      transition: "background 0.15s",
                      background: highlightedCamId === cam.id ? "rgba(59, 130, 246, 0.08)" : undefined,
                    }}
                    onMouseEnter={() => setHighlightedCamId(cam.id)}
                    onMouseLeave={() => setHighlightedCamId(null)}
                    onClick={() => setHighlightedCamId(cam.id)}
                  >
                    {/* Position Number */}
                    <td
                      style={{ padding: "0.85rem 1.25rem", cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setHighlightedCamId(cam.id);
                        setMarkCamId(cam.id);
                        if (fullscreenMode !== "edit") {
                          setPendingPositions({});
                          setFullscreenMode("edit");
                        }
                      }}
                      title={t.markOnSchema}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: "50%",
                        background: connectionMap[cam.id]?.ok
                          ? "linear-gradient(135deg, #10b981, #059669)"
                          : connectionMap[cam.id]?.ok === false
                            ? "linear-gradient(135deg, #ef4444, #dc2626)"
                            : "linear-gradient(135deg, #64748b, #475569)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", fontWeight: 800, fontSize: "0.85rem",
                        fontFamily: "monospace", boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                      }}>
                        {cam.position_number}
                      </div>
                    </td>

                    {/* Label */}
                    <td style={{ padding: "0.85rem 1.25rem" }}>
                      <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text-primary)" }}>
                        {cam.label || formatCameraNumber(t, cam.position_number)}
                      </div>
                      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>
                        {t.schemaCameraType}
                      </div>
                    </td>

                    {/* IP */}
                    <td style={{ padding: "0.85rem 1.25rem", fontSize: "0.85rem" }}>
                      <span style={{ fontFamily: "monospace", color: "var(--text-primary)", fontWeight: 600 }}>
                        {cam.ip_address}
                      </span>
                    </td>

                    {/* Status */}
                    <td style={{ padding: "0.85rem 1.25rem" }}>
                      <ConnectionBadge
                        status={connectionMap[cam.id]?.status || (connectionMap[cam.id]?.ok === false ? "offline" : "checking")}
                        message={connectionMap[cam.id]?.message}
                        checking={!connectionMap[cam.id] || connectionMap[cam.id]?.status === "checking"}
                        compact
                        t={t}
                      />
                    </td>

                    {/* Actions */}
                    <td style={{ padding: "0.85rem 1.25rem", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
                        <button
                          className="btn btn-secondary btn-icon"
                          title={t.liveViewBtn}
                          onClick={() => {
                            const conn = connectionMap[cam.id];
                            if (conn?.ok === false) {
                              showNotification("warning", t.liveNoVideo, conn.message);
                            }
                            openCameraModal(cam, "view");
                          }}
                          style={{ padding: "0.4rem", borderRadius: "0.35rem" }}
                        >
                          <Video size={14} />
                        </button>
                        <button
                          className="btn btn-secondary btn-icon"
                          title={t.edit}
                          onClick={() => openCameraModal(cam, "settings")}
                          style={{ padding: "0.4rem", borderRadius: "0.35rem" }}
                        >
                          <PencilLine size={14} strokeWidth={1.75} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Footer button */}
            <div style={{
              padding: "1rem 1.25rem", borderTop: "1px solid var(--border-color)",
              background: "var(--bg-secondary)", display: "flex", justifyContent: "center",
            }}>
              <button
                type="button" className="btn btn-primary"
                style={{
                  fontSize: "0.85rem", padding: "0.6rem 1.5rem",
                  display: "flex", alignItems: "center", gap: "0.5rem",
                  background: "linear-gradient(135deg, #10b981, #059669)",
                  borderRadius: "0.5rem", boxShadow: "0 2px 8px rgba(16, 185, 129, 0.3)",
                }}
                onClick={handleAddNew}
              >
                <CirclePlus size={16} strokeWidth={1.75} /> {t.addNewCamera}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── SCHEMA CAMERA MODAL ─── */}
      {modalOpen && (
        <SchemaCameraModal
          cam={selectedCam}
          stationId={station?.id}
          token={token}
          t={t}
          initialTab={modalInitialTab}
          clickedCoordinates={clickedCoordinates}
          nextPositionNumber={nextPositionNumber}
          onClose={() => {
            setModalOpen(false);
            setSelectedCam(null);
            setClickedCoordinates(null);
          }}
          onSave={handleSaved}
          showNotification={showNotification}
        />
      )}

      {/* ─── IMAGE UPLOAD MODAL ─── */}
      {imageUploadOpen && (
        <ImageUploadModal
          station={station}
          token={token}
          t={t}
          onClose={() => setImageUploadOpen(false)}
          onUploaded={handleImageUploaded}
          showNotification={showNotification}
        />
      )}

      {/* ─── IMAGE ZOOM OVERLAY ─── */}
      {fullscreenMode && station?.schema_image && (
        <SchemaMapCanvas
          fullscreen
          src={buildMediaUrl(station.schema_image)}
          alt={`${station.name} ${t.schemaOf}`}
          title={fullscreenMode === "edit" ? `${station.name} — ${t.placementModeTitle}` : `${station.name} — ${t.schemaFullscreenTitle}`}
          cameras={camerasForCanvas}
          selectedCamId={markCamId || selectedCam?.id}
          highlightedCamId={highlightedCamId}
          editMode={fullscreenMode === "edit"}
          onCanvasClick={fullscreenMode === "edit" ? handleEditSchemaClick : undefined}
          onPinClick={handlePinClick}
          onPinPositionChange={handlePinPositionChange}
          onClose={() => (fullscreenMode === "edit" ? handleCancelEdit() : setFullscreenMode(null))}
          onSaveLayout={handleSaveLayout}
          onCancelEdit={handleCancelEdit}
          hasPendingChanges={hasPendingChanges}
          savingLayout={savingLayout}
          markCamId={markCamId}
          markingCamLabel={markCamId ? t.placementHint.replace("#{n}", schemaCameras.find(c => c.id === markCamId)?.position_number) : null}
          t={t}
        />
      )}

      {liveFullscreenCam && (
        <SchemaLiveViewer
          cam={liveFullscreenCam}
          token={token}
          t={t}
          onClose={() => setLiveFullscreenCam(null)}
        />
      )}

      {/* Global CSS */}
      <style>{`
        @keyframes pulse-ring {
          0% { transform: translate(-50%, -50%) scale(0.65); opacity: 0.85; }
          100% { transform: translate(-50%, -50%) scale(1.3); opacity: 0; }
        }
        @keyframes pulse-dot {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.65; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .camera-pin-hit--view {
          cursor: pointer;
        }
        .camera-pin-hit--edit {
          cursor: grab;
        }
        .camera-pin-hit--edit:active {
          cursor: grabbing;
        }
        .schema-viewport--view {
          cursor: grab;
        }
        .schema-viewport--edit {
          cursor: grab;
        }
        .schema-edit-toolbar {
          position: absolute;
          top: 18px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 25;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.45rem 0.65rem 0.45rem 0.85rem;
          border-radius: 12px;
          background: rgba(15, 23, 42, 0.88);
          border: 1px solid rgba(255,255,255,0.12);
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 32px rgba(0,0,0,0.35);
        }
        .schema-edit-toolbar-label {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          color: #e2e8f0;
          font-size: 0.78rem;
          font-weight: 600;
          white-space: nowrap;
        }
        .schema-edit-toolbar-actions {
          display: flex;
          gap: 0.4rem;
        }
        .camera-pin-hit {
          user-select: none;
        }
        .camera-pin-wrapper {
          position: relative;
          pointer-events: none;
        }
        .camera-pin-dot {
          position: relative;
          z-index: 2;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1.5px solid #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.28);
          transition: box-shadow 0.2s ease, background 0.2s ease;
        }
        .camera-pin-num {
          color: #fff;
          font-weight: 800;
          font-size: 0.62rem;
          font-family: monospace, sans-serif;
          line-height: 1;
        }
        .camera-pin-pulse {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: rgba(16, 185, 129, 0.12);
          transform: translate(-50%, -50%);
          animation: pulse-ring 2s infinite ease-in-out;
          pointer-events: none;
          z-index: 1;
        }
        .camera-pin-label {
          position: absolute;
          top: 26px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(15, 23, 42, 0.9);
          color: #f8fafc;
          font-size: 0.58rem;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 4px;
          white-space: nowrap;
          pointer-events: none;
          border: 1px solid rgba(255,255,255,0.12);
        }
        .camera-pin-wrapper.is-active .camera-pin-dot {
          background: linear-gradient(135deg, #10b981, #059669);
        }
        .camera-pin-wrapper.is-inactive .camera-pin-dot {
          background: linear-gradient(135deg, #64748b, #475569);
        }
        .camera-pin-wrapper.is-offline .camera-pin-dot {
          background: linear-gradient(135deg, #ef4444, #dc2626);
          box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.35), 0 2px 8px rgba(239, 68, 68, 0.4);
        }
        .camera-pin-wrapper.is-selected .camera-pin-dot {
          background: linear-gradient(135deg, #2563eb, #7c3aed);
          box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.45), 0 2px 8px rgba(0,0,0,0.3);
        }
        .camera-pin-wrapper.is-highlighted .camera-pin-dot {
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5), 0 2px 6px rgba(37,99,235,0.25);
        }
        .camera-pin-hit:hover .camera-pin-dot {
          box-shadow: 0 0 0 2px rgba(255,255,255,0.9), 0 0 0 4px rgba(59, 130, 246, 0.45), 0 2px 8px rgba(0,0,0,0.3);
        }
        .camera-pin-wrapper.is-dragging .camera-pin-dot {
          width: 24px;
          height: 24px;
          background: linear-gradient(135deg, #3b82f6, #2563eb) !important;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.55), 0 4px 14px rgba(37,99,235,0.45);
          cursor: grabbing;
        }
        .camera-pin-wrapper.is-dragging .camera-pin-num {
          font-size: 0.68rem;
        }
        .camera-pin-wrapper.is-dropped .camera-pin-dot {
          background: linear-gradient(135deg, #10b981, #059669) !important;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.5), 0 2px 10px rgba(16,185,129,0.35);
          animation: pin-drop-flash 0.65s ease-out;
        }
        @keyframes pin-drop-flash {
          0% { box-shadow: 0 0 0 5px rgba(16, 185, 129, 0.65), 0 4px 16px rgba(16,185,129,0.5); }
          100% { box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.4), 0 2px 8px rgba(16,185,129,0.25); }
        }
        .schema-canvas-wrap { position: relative; width: 100%; }
        .schema-viewport {
          position: relative;
          width: 100%;
          min-height: 420px;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: grab;
          background: var(--bg-tertiary);
        }
        .schema-viewport--fullscreen {
          width: 100%;
          height: calc(100vh - 80px);
          min-height: 0;
          max-height: none;
        }
        .schema-transform-layer {
          transform-origin: center center;
          will-change: transform;
        }
        .schema-stage {
          position: relative;
          display: inline-block;
          line-height: 0;
          box-shadow: 0 8px 32px rgba(0,0,0,0.15);
          border-radius: 0.35rem;
          overflow: visible;
        }
        .schema-media {
          display: block;
          max-width: 100%;
          width: auto;
          height: auto;
          max-height: 600px;
          pointer-events: none;
          user-select: none;
        }
        .schema-media--pdf {
          width: min(900px, 92vw);
          height: 600px;
          border: none;
          background: #fff;
        }
        .schema-viewport--fullscreen .schema-media {
          max-height: 85vh;
          max-width: 92vw;
        }
        .schema-viewport--fullscreen .schema-media--pdf {
          width: min(1100px, 92vw);
          height: 85vh;
        }
        .schema-zoom-controls {
          position: absolute;
          top: 12px;
          right: 12px;
          z-index: 20;
          display: flex;
          gap: 0.35rem;
          padding: 4px;
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.75);
          border: 1px solid rgba(255,255,255,0.12);
          backdrop-filter: blur(8px);
        }
        .schema-zoom-controls button {
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 7px;
          background: transparent;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .schema-zoom-controls button:hover { background: rgba(255,255,255,0.12); }
        .schema-fullscreen-close { margin-left: 0.15rem; }
        .schema-placement-hint {
          position: absolute;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 20;
          display: flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.45rem 0.85rem;
          border-radius: 999px;
          background: rgba(37, 99, 235, 0.92);
          color: #fff;
          font-size: 0.78rem;
          font-weight: 600;
          box-shadow: 0 4px 20px rgba(37,99,235,0.35);
          pointer-events: none;
        }
        .schema-viewport-hint {
          text-align: center;
          font-size: 0.72rem;
          color: var(--text-muted);
          padding: 0.55rem 1rem 0.75rem;
          background: var(--bg-secondary);
          border-top: 1px solid var(--border-color);
        }
        .schema-fullscreen-overlay {
          position: fixed;
          inset: 0;
          z-index: 2147483646;
          background: rgba(3, 7, 18, 0.96);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .schema-fullscreen-inner {
          position: relative;
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .schema-canvas-wrap--fullscreen {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          width: 100%;
        }
        .schema-canvas-wrap--fullscreen .schema-viewport--fullscreen {
          flex: 1;
          height: auto;
          min-height: 0;
          background: rgba(15, 23, 42, 0.5);
        }
        .schema-canvas-wrap--fullscreen .schema-viewport-hint {
          flex-shrink: 0;
          background: rgba(15, 23, 42, 0.85);
          color: rgba(255,255,255,0.55);
          border-top-color: rgba(255,255,255,0.08);
        }
        .schema-fullscreen-title {
          position: absolute;
          top: 18px;
          left: 20px;
          z-index: 25;
          color: #fff;
          pointer-events: none;
        }
        .schema-fullscreen-exit-btn {
          position: absolute;
          top: 18px;
          right: 18px;
          z-index: 35;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 1px solid rgba(255, 255, 255, 0.15);
          background: rgba(31, 41, 55, 0.88);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          backdrop-filter: blur(8px);
          box-shadow: 0 4px 20px rgba(0,0,0,0.35);
          transition: all 0.2s ease;
        }
        .schema-fullscreen-exit-btn:hover {
          background: rgba(239, 68, 68, 0.88);
          border-color: rgba(239, 68, 68, 0.5);
        }
        .schema-fullscreen-inner .schema-zoom-controls { top: 18px; right: 72px; }
        .schema-fullscreen-inner .schema-placement-hint { top: 18px; }
      `}</style>
    </div>
  );
}
