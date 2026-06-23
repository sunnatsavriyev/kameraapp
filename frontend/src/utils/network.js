import { LOCAL_AGENT_URL } from "../config";
import { useLocalAgentForIp } from "./cameraMode";

/** Lokal tarmoq IP — serverdan to'g'ridan ulanmaydi */
export function isLocalNetworkIp(ip) {
  const parts = (ip || "").trim().split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums;
  if (a === 10 || a === 11 || a === 22 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

let agentCache = { ok: false, checkedAt: 0 };

export async function isLocalAgentAvailable(force = false) {
  const now = Date.now();
  if (!force && now - agentCache.checkedAt < 5000) return agentCache.ok;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const resp = await fetch(`${LOCAL_AGENT_URL}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    agentCache = { ok: resp.ok, checkedAt: now };
    return resp.ok;
  } catch {
    agentCache = { ok: false, checkedAt: now };
    return false;
  }
}

export async function syncFromServer(token) {
  const resp = await fetch(`${LOCAL_AGENT_URL}/api/sync/pull-from-server`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error("Sync failed");
  return resp.json();
}

export function pickConnectionApiBase(ip, agentAvailable) {
  if (useLocalAgentForIp(ip, agentAvailable)) return LOCAL_AGENT_URL;
  return null;
}
