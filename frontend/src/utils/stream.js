import { API_BASE_URL, LOCAL_AGENT_URL, SERVER_API_URL } from "../config";
import { isLocalNetworkIp } from "./network";
import { useLocalAgentForIp } from "./cameraMode";

export function resolveStreamMode({ ip, localAgentAvailable, connectionStatus, isLocalOnly }) {
  const local = isLocalNetworkIp(ip) || isLocalOnly || connectionStatus?.status === "local_only";
  if (useLocalAgentForIp(ip, localAgentAvailable)) return "local_agent";
  if (local) return "direct";
  return "server";
}

export function getSchemaLiveUrl({
  camId,
  fields,
  token,
  mode,
  directPath = "/cgi-bin/snapshot.cgi",
  tick = 0,
}) {
  const ip = fields?.ip_address;
  const httpPort = fields?.http_port || 80;

  if (mode === "local_agent" && camId && fields?.ip_address) {
    const q = new URLSearchParams({
      ip_address: fields.ip_address,
      login: fields.login || "admin",
      password: fields.password || "",
      http_port: String(fields.http_port || 80),
      rtsp_port: String(fields.rtsp_port || 554),
      stream_path: fields.stream_path || "",
      t: String(tick),
    });
    return `${LOCAL_AGENT_URL}/api/schema-cameras/${camId}/live/?${q}`;
  }
  if (mode === "direct" && ip) {
    return `http://${ip}:${httpPort}${directPath}?t=${tick}`;
  }
  if (camId && token) {
    return `${SERVER_API_URL}/api/schema-cameras/${camId}/live/?token=${token}&t=${tick}`;
  }
  return null;
}

import { useLocalAgentForIp } from "./cameraMode";

export function canShowLiveStream({ connectionStatus, localAgentAvailable, ip }) {
  if (connectionStatus?.ok) return true;
  if (connectionStatus?.status === "local_only") {
    return useLocalAgentForIp(ip, localAgentAvailable);
  }
  return false;
}
