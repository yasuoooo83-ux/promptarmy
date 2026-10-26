// 再生制御。タイマーは常に1本だけ（世代番号で古いタイマーを無効にして、連打しても二重再生にならない）。
// 1ターン＝合戦内の1秒。通常は実時間の1秒で再生する
export const SPEEDS = { watch: 1600, normal: 1000, fast: 250 };

export function createPlayer({ frameCount, onFrame, onState }) {
  let idx = 0;
  let playing = false;
  let timer = null;
  let gen = 0;
  let interval = SPEEDS.normal;
  const last = () => frameCount - 1;

  function clear() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    gen++;
  }
  function notify() {
    if (onState) onState({ idx, playing, interval, last: last() });
  }
  function schedule() {
    const g = gen;
    timer = setTimeout(() => {
      if (g !== gen || !playing) return;
      if (idx >= last()) {
        playing = false;
        clear();
        notify();
        return;
      }
      idx++;
      onFrame(idx, { animate: true });
      if (idx >= last()) {
        playing = false;
        clear();
        notify();
        return;
      }
      schedule();
    }, interval);
  }

  return {
    get index() { return idx; },
    get playing() { return playing; },
    play() {
      clear(); // 既存のタイマーを必ず止めてから始める
      if (idx >= last()) {
        idx = 0;
        onFrame(idx, { animate: false });
      }
      playing = true;
      schedule();
      notify();
    },
    pause() {
      playing = false;
      clear();
      notify();
    },
    step() {
      playing = false;
      clear();
      if (idx < last()) {
        idx++;
        onFrame(idx, { animate: true });
      }
      notify();
    },
    toEnd() {
      playing = false;
      clear();
      idx = last();
      onFrame(idx, { animate: false });
      notify();
    },
    // 指定の番号へ飛ぶ（決戦の再開に使う）
    seek(i) {
      playing = false;
      clear();
      idx = Math.max(0, Math.min(last(), i));
      onFrame(idx, { animate: false });
      notify();
    },
    restart() {
      playing = false;
      clear();
      idx = 0;
      onFrame(idx, { animate: false });
      notify();
    },
    setSpeed(ms) {
      interval = ms;
      if (playing) {
        clear();
        schedule();
      }
      notify();
    },
    destroy() {
      playing = false;
      clear();
    },
  };
}
