/**
 * The client details the app can report about itself (SCRUM-179, SCRUM-319): the feedback ticket
 * sends them, and the version badge copies the same block so a report can be pasted whole.
 */
import { APP_VERSION } from '../version';

export interface ClientInfo {
  app_version: string;
  timezone: string;
  user_agent: string;
}

/** Feedback truncates the agent to 200 characters; the version copy keeps the same limit. */
export const MAX_USER_AGENT_LENGTH = 200;

export function clientInfo(): ClientInfo {
  return {
    app_version: APP_VERSION,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    user_agent: navigator.userAgent.slice(0, MAX_USER_AGENT_LENGTH),
  };
}

/** The copyable block: app version, user timezone and the browser's user agent. */
export function buildVersionReport(info: ClientInfo = clientInfo()): string {
  return [
    `Wind Map v${info.app_version}`,
    `Timezone: ${info.timezone || 'unknown'}`,
    `Browser: ${info.user_agent || 'unknown'}`,
  ].join('\n');
}

/** Copy `text`, answering whether the browser accepted it; no exception escapes. */
export async function copyText(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
