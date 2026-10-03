import { useEffect, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import { t } from "../../shared/i18n.ts";
import { playMeditationMusic } from "./meditationAudio";

const durations = [5, 10, 15];
const storageKey = "xihack-meditation-timer";

function savedTimer() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
    const minutes = durations.includes(saved.minutes) ? saved.minutes : 5;
    const endAt = typeof saved.endAt === "number" && saved.endAt > 0 ? saved.endAt : 0;
    const remaining = endAt ? Math.max(0, Math.ceil((endAt - Date.now()) / 1000)) : Number.isInteger(saved.remaining) && saved.remaining >= 0 && saved.remaining <= minutes * 60 ? saved.remaining : minutes * 60;
    return { minutes, remaining, endAt: remaining > 0 ? endAt : 0 };
  } catch { return { minutes: 5, remaining: 300, endAt: 0 }; }
}

export function MeditationCard() {
  const [initial] = useState(savedTimer);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [remaining, setRemaining] = useState(initial.remaining);
  const [running, setRunning] = useState(initial.endAt > 0);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicError, setMusicError] = useState(false);
  const endAt = useRef(initial.endAt);
  const music = useRef<ReturnType<typeof playMeditationMusic> | null>(null);

  useEffect(() => () => { music.current?.stop(); }, []);
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ minutes, remaining, endAt: running ? endAt.current : 0 })); }
    catch { /* Timer still works when storage is unavailable. */ }
  }, [minutes, remaining, running]);

  function stopMusic() {
    music.current?.stop();
    music.current = null;
    setMusicPlaying(false);
  }

  function toggleMusic() {
    if (music.current) { stopMusic(); return; }
    try {
      const playback = playMeditationMusic();
      music.current = playback;
      setMusicPlaying(true);
      setMusicError(false);
      void playback.ready.catch(() => {
        if (music.current === playback) { stopMusic(); setMusicError(true); }
      });
    } catch { setMusicError(true); }
  }

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
      setRemaining(next);
      if (next === 0) { setRunning(false); stopMusic(); }
    }, 250);
    return () => window.clearInterval(timer);
  }, [running]);

  function selectDuration(value: number) {
    setMinutes(value);
    setRemaining(value * 60);
  }

  function toggleTimer() {
    if (running) {
      setRemaining(Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000)));
      setRunning(false);
    } else {
      endAt.current = Date.now() + (remaining || minutes * 60) * 1000;
      if (remaining === 0) setRemaining(minutes * 60);
      setRunning(true);
    }
  }

  const clock = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;

  return <section className="meditation-panel" aria-labelledby="meditation-title">
    <div className="meditation-heading"><div><h2 id="meditation-title">{t("meditationTitle")}</h2><p>{t("meditationIntro")}</p></div><label className="meditation-duration"><span className="sr-only">{t("meditationDuration")}</span><select value={minutes} disabled={running} onChange={(event) => selectDuration(Number(event.target.value))}>{durations.map((value) => <option key={value} value={value}>{value} {t("meditationMinuteShort")}</option>)}</select></label></div>
    <div className="meditation-center">
      <span className="meditation-clock" role="timer" aria-label={t("meditationTimeRemaining")}>{clock}</span>
      {remaining === 0 && <p className="meditation-complete" role="status">{t("meditationComplete")}</p>}
      <div className="meditation-actions"><button type="button" className="button button-primary" onClick={toggleTimer}><Icon name={running ? "pause" : "play"} size={17} />{running ? t("meditationPause") : t("meditationStart")}</button>{(running || remaining !== minutes * 60) && <button type="button" className="meditation-reset" onClick={() => { setRunning(false); setRemaining(minutes * 60); }}>{t("meditationReset")}</button>}</div>
    </div>
    <div className="meditation-footer"><button type="button" className="meditation-music" aria-pressed={musicPlaying} onClick={toggleMusic}><Icon name="music" size={18} />{musicPlaying ? t("meditationMusicStop") : t("meditationMusicPlay")}</button>{musicError && <p role="alert">{t("meditationMusicError")}</p>}</div>
  </section>;
}
