// timeFormat.js
// All durations shown or announced to the user must be spoken in natural
// language (e.g. "2 minutes 36 seconds"), never as raw digit/seconds
// formatting like "2:36", which is not understandable when read by a
// screen reader.

/**
 * Convert a whole number of seconds into a natural-language duration.
 * Examples:
 *   0        -> "0 seconds"
 *   5        -> "5 seconds"
 *   60       -> "1 minute"
 *   96       -> "1 minute 36 seconds"
 *   3661     -> "1 hour 1 minute 1 second"
 */
export function formatDurationNatural(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs} ${secs === 1 ? "second" : "seconds"}`);

  return parts.join(" ");
}

/**
 * Format a creation date/time in natural, readable language.
 */
export function formatDateNatural(isoString) {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "unknown date";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }) + " at " + date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
