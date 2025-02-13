import escapeStringRegexp from "escape-string-regexp";
import { DateTime } from "luxon";
import { z } from "zod";

const href = new URL(window.location.href);
const zone = href.searchParams.get("zone");

export const ClipScheme = z.object({
  id: z.string(),
  url: z.string(),
  embedUrl: z.string(),
  broadcasterId: z.string(),
  creatorId: z.string(),
  creatorDisplayName: z.string(),
  videoId: z.string(),
  gameId: z.string(),
  language: z.string(),
  title: z.string(),
  views: z.number(),
  creationDate: z.date().or(z.string().transform((value) => Date.parse(value))),
  thumbnailUrl: z.string(),
  duration: z.number(),
  vodOffset: z.number().nullable(),
  isFeatured: z.boolean(),
});

export const GameScheme = z.object({
  id: z.string(),
  name: z.string(),
  igdbId: z.string().nullable(),
  boxArtUrl: z.string(),
});

export function renderClip(
  template: string,
  clip: z.output<typeof ClipScheme>,
): string {
  const keys: (keyof z.output<typeof ClipScheme>)[] = [
    "id",
    "url",
    "embedUrl",
    "broadcasterId",
    "creatorId",
    "creatorDisplayName",
    "videoId",
    "gameId",
    "language",
    "title",
    "views",
    "creationDate",
    "thumbnailUrl",
    "duration",
    "vodOffset",
    "isFeatured",
  ];

  let result = template;
  for (const key of keys) {
    const regex = new RegExp(
      "{clip\\.(?<key>" +
        escapeStringRegexp(key as string) +
        ")(?:\\:(?<format>[^}]+))?}",
      "g",
    );
    result = result.replaceAll(
      regex,
      (_value, _key, format: string | undefined) => {
        const value: unknown = clip[key];
        if (format !== undefined && value instanceof Date) {
          let date = DateTime.fromJSDate(value);
          if (zone !== null) {
            date = date.setZone(zone);
          }
          return date.toFormat(format);
        }
        return String(value);
      },
    );
  }
  return result;
}

export function renderGame(
  template: string,
  game: z.output<typeof GameScheme> | undefined,
): string {
  const keys: (keyof z.output<typeof GameScheme>)[] = [
    "id",
    "name",
    "igdbId",
    "boxArtUrl",
  ];

  let result = template;
  for (const key of keys) {
    const regex = new RegExp(
      "{game\\.(?<key>" +
        escapeStringRegexp(key as string) +
        ")(?:\\:(?<format>[^}]+))?}",
      "g",
    );
    result = result.replaceAll(
      regex,
      (_value, _key, format: string | undefined) => {
        if (game === undefined) {
          return "";
        }
        const value: unknown = game[key];
        if (format !== undefined && value instanceof Date) {
          let date = DateTime.fromJSDate(value);
          if (zone !== null) {
            date = date.setZone(zone);
          }
          return date.toFormat(format);
        }
        return String(value);
      },
    );
  }
  return result;
}
