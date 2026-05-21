export const APP_TIME_ZONE = "Asia/Shanghai";

const shanghaiDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: APP_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const shanghaiTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: APP_TIME_ZONE,
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function toDate(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function dateTimeParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    shanghaiDateTimeFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
}

export function formatShanghaiDateTime(value: Date | number | string = new Date()): string {
  const date = toDate(value);
  const parts = dateTimeParts(date);
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${milliseconds} +08:00`;
}

export function formatShanghaiTime(value: Date | number | string): string {
  return shanghaiTimeFormatter.format(toDate(value));
}
