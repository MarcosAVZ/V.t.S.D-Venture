// Today as YYYY-MM-DD in Argentina local time (a UTC date would roll over at 21:00 ART)
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function todayAR(now = new Date()) {
  return formatter.format(now);
}
