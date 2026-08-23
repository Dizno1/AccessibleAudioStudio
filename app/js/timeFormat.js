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
 * Convert a fractional number of seconds into a natural-language, precise
 * time position, for the audio editor's nonvisual navigation. Precision is
 * kept to whole milliseconds (three decimal places) since that is what
 * sample-accurate editing needs, and it is spoken as part of the seconds
 * value rather than as a separate digit group, which is what keeps it
 * readable by a screen reader:
 *   1.5       -> "1.500 seconds"
 *   74.25     -> "1 minute 14.250 seconds"
 *   3661.005  -> "1 hour 1 minute 1.005 seconds"
 */
export function formatTimePrecise(totalSeconds) {
  const total = Math.max(0, totalSeconds || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total - hours * 3600 - minutes * 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  parts.push(`${secs.toFixed(3)} ${Math.abs(secs - 1) < 0.0005 ? "second" : "seconds"}`);

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
