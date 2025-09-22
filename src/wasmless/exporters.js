// src/wasmless/exporters.js
// WAV 16-bit (dither ringan) & MP3 (CBR) via lamejs UMD (global), anti “MPEGMode is not defined”.

// ---------- WAV (16-bit PCM + dither, auto headroom -1 dBFS) ----------
export function audioBufferToWav(audioBuffer) {
  const numCh = audioBuffer.numberOfChannels;
  const sr = audioBuffer.sampleRate;
  const len = audioBuffer.length;

  // Auto headroom -1 dBFS
  const target = Math.pow(10, -1.0 / 20);
  let peak = 0;
  for (let c = 0; c < numCh; c++) {
    const ch = audioBuffer.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const v = Math.abs(ch[i]);
      if (v > peak) peak = v;
    }
  }
  const scale = peak > target ? target / peak : 1;

  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const buffer = new ArrayBuffer(44 + len * blockAlign);
  const view = new DataView(buffer);

  function W(off, s) { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }
  let pos = 0;
  W(0, "RIFF");
  view.setUint32(4, 36 + len * blockAlign, true);
  W(8, "WAVE");
  W(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  W(36, "data");
  view.setUint32(40, len * blockAlign, true);
  pos = 44;

  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const x0 = audioBuffer.getChannelData(c)[i] * scale + (Math.random() - Math.random()) * 1e-5; // dither TPDF
      const x = Math.max(-1, Math.min(1, x0));
      view.setInt16(pos, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      pos += 2;
    }
  }
  return new Blob([view], { type: "audio/wav" });
}

// ---------- Helper: muat lamejs UMD (lokal → CDN) ----------
let lameReadyPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some(s => s.src && s.src.endsWith(src))) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Gagal memuat " + src));
    document.head.appendChild(s);
  });
}

function ensureGlobalEnums(ns) {
  if (typeof window === "undefined") return;
  if (!("MPEGMode" in window) && "MPEGMode" in ns) window.MPEGMode = ns.MPEGMode;
  if (!("VBRMode"  in window) && "VBRMode"  in ns) window.VBRMode  = ns.VBRMode;
  if (!("Preset"   in window) && "Preset"   in ns) window.Preset   = ns.Preset;
}

async function getLame() {
  // Sudah ada?
  if (typeof window !== "undefined" && window.lamejs && window.lamejs.Mp3Encoder) {
    ensureGlobalEnums(window.lamejs);
    return window.lamejs;
  }
  if (!lameReadyPromise) {
    lameReadyPromise = (async () => {
      // 1) Coba lokal
      try {
        await loadScript("/lame.min.js");
      } catch (_) {
        // 2) Fallback CDN
        await loadScript("https://cdn.jsdelivr.net/npm/lamejs@1.2.0/lame.min.js");
      }
      if (!window.lamejs || !window.lamejs.Mp3Encoder) throw new Error("lamejs tidak tersedia");
      ensureGlobalEnums(window.lamejs);
      return window.lamejs;
    })();
  }
  return lameReadyPromise;
}

// ---------- MP3 (CBR) via lamejs UMD, auto headroom -1 dBFS ----------
export async function audioBufferToMp3(audioBuffer, kbps = 192) {
  const lame = await getLame();
  const { Mp3Encoder } = lame;

  const numCh = audioBuffer.numberOfChannels;
  const sr = audioBuffer.sampleRate;
  const len = audioBuffer.length;

  // Auto headroom -1 dBFS
  const target = Math.pow(10, -1.0 / 20);
  let peak = 0;
  for (let c = 0; c < numCh; c++) {
    const ch = audioBuffer.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const v = Math.abs(ch[i]);
      if (v > peak) peak = v;
    }
  }
  const scale = peak > target ? target / peak : 1;

  const encoder = new Mp3Encoder(numCh, sr, parseInt(kbps, 10));

  const toI16 = (f32) => {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      let s = Math.max(-1, Math.min(1, f32[i] * scale));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return i16;
  };

  const L = toI16(audioBuffer.getChannelData(0));
  const R = numCh > 1 ? toI16(audioBuffer.getChannelData(1)) : null;

  const maxSamples = 1152;
  const out = [];
  for (let i = 0; i < L.length; i += maxSamples) {
    const lch = L.subarray(i, Math.min(i + maxSamples, L.length));
    const rch = R ? R.subarray(i, Math.min(i + maxSamples, R.length)) : null;
    const mp3buf = numCh === 2 && rch ? encoder.encodeBuffer(lch, rch) : encoder.encodeBuffer(lch);
    if (mp3buf.length) out.push(mp3buf);
  }
  const end = encoder.flush();
  if (end.length) out.push(end);

  return new Blob(out, { type: "audio/mpeg" });
}
