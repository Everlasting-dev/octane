"use client"

export interface FriendlyError {
  title: string
  message: string
  details?: string
}

export function errorDetails(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function withDetails(title: string, message: string, raw: string): FriendlyError {
  const clean = raw.trim()
  return {
    title,
    message,
    details: clean && clean !== message ? clean : undefined,
  }
}

export function friendlyAuthError(error: unknown): FriendlyError {
  const raw = errorDetails(error)
  const lower = raw.toLowerCase()

  if (!raw.trim()) {
    return {
      title: "Sign in failed",
      message: "Octane could not sign in. Check the email and password, then try again.",
    }
  }

  if (/invalid.*login|invalid.*credential|invalid_grant|email.*password|password.*invalid|credentials/i.test(raw)) {
    return withDetails("Check your login", "The email or password was not accepted. Please re-enter them and try again.", raw)
  }

  if (/email.*confirm|not.*confirmed/i.test(raw)) {
    return withDetails("Email not confirmed", "This account still needs email confirmation before Octane can sign in.", raw)
  }

  if (/fetch failed|network|cannot reach|offline|internet|econn|enotfound|etimedout|timeout|dns|supabase/.test(lower)) {
    return withDetails("Connection problem", "Octane could not reach the login server. Check the internet connection and try again.", raw)
  }

  if (/refresh token|session|jwt|unauthorized|forbidden|\b401\b|\b403\b|not authorized/.test(lower)) {
    return withDetails("Session needs sign in", "Your saved session could not be validated. Sign in again to refresh access.", raw)
  }

  return withDetails("Sign in failed", "Octane could not complete sign in. Try again, or check the details below.", raw)
}

export function friendlyUpdateError(error: unknown): FriendlyError {
  const raw = errorDetails(error)
  const lower = raw.toLowerCase()

  if (!raw.trim()) {
    return {
      title: "Update failed",
      message: "Octane could not finish the update check. Try again in a moment.",
    }
  }

  if (/certificate|cert_|self signed|unable to verify|signature|signed|publisher|not trusted|trust/.test(lower)) {
    return withDetails(
      "Certificate validation failed",
      "Windows could not verify the update certificate or signature. Install the Octane certificate on this PC, then run the update again.",
      raw,
    )
  }

  if (/fetch failed|network|offline|internet|econn|enotfound|etimedout|timeout|dns|github|release/i.test(raw)) {
    return withDetails("Update server unreachable", "Octane could not reach the update server. Check the connection and try again.", raw)
  }

  if (/unauthorized|forbidden|\b401\b|\b403\b|authentication|auth|access denied/.test(lower)) {
    return withDetails("Update access denied", "Octane could not validate access for this update. Sign in again, then retry the update.", raw)
  }

  if (/no published versions|latest version|not found|\b404\b|artifact|yml|yaml/.test(lower)) {
    return withDetails("Update package missing", "The update package could not be found. Publish a valid Octane release package and try again.", raw)
  }

  if (/quitandinstall|install|installer|permission|eperm|eacces|busy|locked/.test(lower)) {
    return withDetails("Installer could not start", "Close other Octane windows and make sure this Windows account can install apps, then try again.", raw)
  }

  return withDetails("Update failed", "Octane could not complete the update. Try again, or check the details below.", raw)
}

export function friendlyFileError(error: unknown, fileName?: string): FriendlyError {
  const raw = errorDetails(error)
  const lower = raw.toLowerCase()
  const target = fileName ? ` ${fileName}` : " this log"

  if (/only csv and txt|extension|file type/.test(lower)) {
    return withDetails("Unsupported file", `Octane can open CSV or TXT log files. Choose a supported log file to continue.`, raw)
  }

  if (/empty|header row|data row|numeric signal|parseable/.test(lower)) {
    return withDetails("Log data not readable", `Octane could not find usable channel data in${target}. Check that the file has a header row and numeric samples.`, raw)
  }

  if (/permission|eacces|eperm|locked|busy/.test(lower)) {
    return withDetails("File is not accessible", `Octane could not read${target}. Close other programs using it, then try again.`, raw)
  }

  return withDetails("Could not open log", `Octane could not open${target}. Check the file and try again.`, raw)
}

export function friendlyCloudLogError(error: unknown): FriendlyError {
  const raw = errorDetails(error)
  const lower = raw.toLowerCase()

  if (!raw.trim()) {
    return {
      title: "Cloud Logs unavailable",
      message: "Octane could not finish that cloud log action. Try again in a moment.",
    }
  }

  if (/admin account|only enabled|not authorized|unauthorized|forbidden|\b401\b|\b403\b|rls|row-level/.test(lower)) {
    return withDetails("Admin access required", "Cloud Logs are restricted to the Octane admin account.", raw)
  }

  if (/sign in|session|refresh|jwt|token|expired/.test(lower)) {
    return withDetails("Cloud session expired", "Sign in to Octane again, then retry the cloud log action.", raw)
  }

  if (/cloud_logs|schema cache|relation|table|bucket|octane-logs|does not exist|not found|\b404\b/.test(lower)) {
    return withDetails("Cloud library not set up", "Create the Octane cloud log table and private storage bucket in Supabase, then try again.", raw)
  }

  if (/already saved|duplicate|asset already exists|23505/.test(lower)) {
    return withDetails("Already saved", "This log already exists in the cloud library.", raw)
  }

  if (/original file text|no original|no file text/.test(lower)) {
    return withDetails("Original log unavailable", "Reopen the original CSV/TXT log before uploading it to the cloud library.", raw)
  }

  if (/network|fetch failed|cannot reach|offline|internet|econn|enotfound|etimedout|timeout|supabase/.test(lower)) {
    return withDetails("Connection problem", "Octane could not reach the cloud log library. Check the connection and try again.", raw)
  }

  if (/download|gzip|incorrect header|invalid stored block|decompress/.test(lower)) {
    return withDetails("Cloud log could not load", "Octane could not download or unpack this cloud log. Try another log or upload it again.", raw)
  }

  return withDetails("Cloud Logs error", "Octane could not complete that cloud log action. Try again, or check the details below.", raw)
}
