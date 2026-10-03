import { useEffect, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import { t } from "../../shared/i18n.ts";
import { playMeditationMusic } from "./meditationAudio";

const durations = [5, 10, 15];

export function MeditationCard() {
  const [minutes, setMinutes] = useState(5);
  const [remaining, setRemaining] = useState(5 * 60);
  const [running, setRunning] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicError, setMusicError] = useState(false);
  const endAt = useRef(0);
  const music = useRef<ReturnType<typeof playMeditationMusic> | null>(null);

  useEffect(() => () => { music.current?.stop(); }, []);

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
    <div className="meditation-heading"><span className="meditation-mark" aria-hidden="true" /><div><h2 id="meditation-title">{t("meditationTitle")}</h2><p>{t("meditationIntro")}</p></div></div>
    <div className="meditation-controls">
      <div className="meditation-durations" role="group" aria-label={t("meditationDuration")}>{durations.map((value) => <button key={value} type="button" aria-pressed={minutes === value} disabled={running} onClick={() => selectDuration(value)}>{value} {t("meditationMinuteShort")}</button>)}</div>
      <div className="meditation-timer"><span role="timer" aria-label={t("meditationTimeRemaining")}>{clock}</span><div className="meditation-actions"><button type="button" className="button button-primary" onClick={toggleTimer}><Icon name={running ? "pause" : "play"} size={17} />{running ? t("meditationPause") : t("meditationStart")}</button><button type="button" className="button button-outline" onClick={() => { setRunning(false); setRemaining(minutes * 60); }}>{t("meditationReset")}</button></div></div>
      {remaining === 0 && <p className="meditation-complete" role="status">{t("meditationComplete")}</p>}
    </div>
    <div className="meditation-music"><div><Icon name="music" size={19} /><span><strong>{t("meditationMusic")}</strong><small>{t("meditationMusicHint")}</small></span></div><button type="button" aria-pressed={musicPlaying} onClick={toggleMusic}>{musicPlaying ? t("meditationMusicStop") : t("meditationMusicPlay")}</button>{musicError && <p role="alert">{t("meditationMusicError")}</p>}</div>
  </section>;
}
