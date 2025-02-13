import { useEffect, useState } from "react";
import { ClipScheme, GameScheme, renderClip, renderGame } from "./render";
import { z } from "zod";

const href = new URL(window.location.href);
const top = href.searchParams.get("top") ?? "{clip.title}";
const bottom =
  href.searchParams.get("bottom") ?? "clipped by {clip.creatorDisplayName}";

function jsonSafeParse(value: string | null): unknown {
  if (value === null) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (e) {
    console.error(e);
    return null;
  }
}

function TextOnly({ prefix }: { prefix: string }) {
  const [clip, setClip] = useState<z.output<typeof ClipScheme> | null>(null);
  const [game, setGame] = useState<z.output<typeof GameScheme> | null>(null);
  useEffect(() => {
    const clip = ClipScheme.safeParse(
      jsonSafeParse(localStorage.getItem(`${prefix}current-clip`)),
    );
    if (!clip.success) {
      console.error(clip.error);
    }
    setClip(clip.success ? clip.data : null);
    const game = GameScheme.safeParse(
      jsonSafeParse(localStorage.getItem(`${prefix}current-game`)),
    );
    if (!game.success) {
      console.error(game.error);
    }
    setGame(game.success ? game.data : null);
    const controller = new AbortController();
    window.addEventListener(
      "storage",
      (e) => {
        if (e.storageArea === localStorage) {
          if (e.key === `${prefix}current-clip`) {
            const clip = ClipScheme.safeParse(jsonSafeParse(e.newValue));
            if (!clip.success) {
              console.error(clip.error);
            }
            setClip(clip.success ? clip.data : null);
          } else if (e.key === `${prefix}current-game`) {
            const game = GameScheme.safeParse(jsonSafeParse(e.newValue));
            if (!game.success) {
              console.error(game.error);
            }
            setGame(game.success ? game.data : null);
          }
        }
      },
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [setGame, setClip, prefix]);
  if (game == null || clip == null) {
    return <></>;
  }
  return (
    <>
      <div className="overlay overlay-top">
        {renderGame(renderClip(top, clip), game)}
      </div>
      <div className="overlay overlay-bottom">
        {renderGame(renderClip(bottom, clip), game)}
      </div>
    </>
  );
}

export default TextOnly;
