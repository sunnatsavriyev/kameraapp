// Dev rejimda Vite /api proxy orqali serverga ulanadi (CORS yo'q)
const useProxy = import.meta.env.DEV && import.meta.env.VITE_USE_API_PROXY !== "false";

export const API_BASE_URL = useProxy
  ? ""
  : (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000");

export const LOCAL_AGENT_URL = import.meta.env.VITE_LOCAL_AGENT_URL || "http://127.0.0.1:8765";
export const SERVER_API_URL = import.meta.env.VITE_SERVER_API_URL || import.meta.env.VITE_API_BASE_URL || API_BASE_URL;
export const IS_DESKTOP_MODE = import.meta.env.VITE_APP_MODE === "desktop";
