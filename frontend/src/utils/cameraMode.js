import { IS_DESKTOP_MODE } from "../config";
import { isLocalNetworkIp } from "./network";

/** Desktop (.bat): 192.x → Local Agent; Server brauzer: faqat server */
export function useLocalAgentForIp(ip, agentAvailable) {
  return IS_DESKTOP_MODE && isLocalNetworkIp(ip) && agentAvailable;
}

/** 88.x va ommaviy IP — doim server orqali */
export function useServerForIp(ip) {
  return !isLocalNetworkIp(ip);
}

/** Ro'yxat tekshiruvi: lokal IP desktopda agent, qolgani server */
export function getConnectionTestOptions(ip) {
  const isLocal = isLocalNetworkIp(ip);
  if (IS_DESKTOP_MODE && isLocal) {
    return { quick: true, timeoutMs: 15000, viaAgent: true };
  }
  if (isLocal) {
    return { quick: true, timeoutMs: 12000, viaAgent: false };
  }
  return { quick: false, timeoutMs: 40000, viaAgent: false };
}
