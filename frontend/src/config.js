// API so'rovlari: dev da Vite proxy (/api → server)
// Video stream: doim to'g'ridan serverga (proxy MJPEG ni uzadi)
const serverUrl = (
  import.meta.env.VITE_SERVER_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://88.88.0.151:8090"
).replace(/\/$/, "");

const useProxy = import.meta.env.DEV && import.meta.env.VITE_USE_API_PROXY !== "false";

export const API_BASE_URL = useProxy ? "" : serverUrl;
export const SERVER_API_URL = serverUrl;
export const LOCAL_AGENT_URL = import.meta.env.VITE_LOCAL_AGENT_URL || "http://127.0.0.1:8765";
export const IS_DESKTOP_MODE = import.meta.env.VITE_APP_MODE === "desktop";
