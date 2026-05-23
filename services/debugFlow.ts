let debugHomeAccessInSession = false;

/**
 * CURRENT PHASE (debug):
 * welcome -> questionnaire -> save -> home
 * reopen -> welcome
 *
 * LATER PHASE (paywall):
 * welcome -> questionnaire -> save -> paywall -> (paid ? home : welcome)
 * reopen -> (paid ? home : welcome)
 */
export function grantDebugHomeAccess(): void {
  debugHomeAccessInSession = true;
}

export function hasDebugHomeAccess(): boolean {
  return debugHomeAccessInSession;
}

export function clearDebugHomeAccess(): void {
  debugHomeAccessInSession = false;
}
