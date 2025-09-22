// =============================================
// FILE: src/wasmless/dsp.js
// (OfflineAudioContext render 48 kHz + preset + tone user)
// =============================================
export async function enhanceArrayBuffer(arrayBuffer, options={}){
  const preset = options.preset || 'clean'
  const sr = options.targetSampleRate || 48000
  const tone = options.tone || { vol:1, bass:0, vocal:0, treble:0 }

  // Probe to size context
  const probeCtx = new (window.OfflineAudioContext||window.webkitOfflineAudioContext)(1, 1, sr)
  const temp = await probeCtx.decodeAudioData(arrayBuffer.slice(0))
  const frames = Math.ceil(temp.duration * sr)

  const ac = new (window.OfflineAudioContext||window.webkitOfflineAudioContext)(Math.min(2, temp.numberOfChannels||2), frames, sr)
  const audioBuf = await ac.decodeAudioData(arrayBuffer.slice(0))

  const src = ac.createBufferSource(); src.buffer = audioBuf

  const chain = buildPresetChain(ac, preset, tone)
  let head = src
  for (const node of chain){ head.connect(node); head = node }
  head.connect(ac.destination)

  src.start()
  const rendered = await ac.startRendering()
  return rendered // AudioBuffer 48 kHz, float32
}

function buildPresetChain(ac, preset, tone){
  const HPF = (f=50)=>{ const n = ac.createBiquadFilter(); n.type='highpass'; n.frequency.value=f; n.Q.value=0.707; return n }
  const LPF = (f=18000)=>{ const n = ac.createBiquadFilter(); n.type='lowpass'; n.frequency.value=f; n.Q.value=0.707; return n }
  const peak = (f,g,Q=1)=>{ const n = ac.createBiquadFilter(); n.type='peaking'; n.frequency.value=f; n.gain.value=g; n.Q.value=Q; return n }
  const shelfHi = (f,g)=>{ const n = ac.createBiquadFilter(); n.type='highshelf'; n.frequency.value=f; n.gain.value=g; return n }
  const shelfLo = (f,g)=>{ const n = ac.createBiquadFilter(); n.type='lowshelf'; n.frequency.value=f; n.gain.value=g; return n }
  const comp = (thr=-18,ratio=3,att=0.005,rel=0.06,knee=6)=>{ const n = ac.createDynamicsCompressor(); n.threshold.value=thr; n.ratio.value=ratio; n.attack.value=att; n.release.value=rel; n.knee.value=knee; return n }
  const gain = (g=1)=>{ const n = ac.createGain(); n.gain.value=g; return n }

  // Preset base chains
  const CLEAN = [ HPF(40), peak(3500, 1.0, 0.9), comp(-18, 2.5, 0.004, 0.08, 4), shelfHi(12000, 0.8) ]
  const JAZZ  = [ HPF(45), peak(200, -1.0, 1.0), peak(3200, 1.2, 0.9), comp(-20, 2.2, 0.006, 0.09, 6), LPF(17500) ]
  const CUBANO= [ HPF(35), shelfLo(90, 1.0), peak(6500, -2.0, 1.2), peak(3500, 1.5, 0.9), comp(-18, 3.0, 0.005, 0.08, 6), shelfHi(14000, 1.0) ]
  const BLUES = [ HPF(50), peak(180, 0.8, 0.9), peak(4500, -1.5, 1.1), comp(-21, 2.0, 0.007, 0.10, 6), LPF(16000) ]
  const LATIN = [ HPF(40), peak(120, 0.8, 0.8), peak(3000, 1.3, 0.9), comp(-19, 2.6, 0.005, 0.08, 6), shelfHi(13000, 0.8) ]
  const EDM   = [ HPF(30), shelfLo(80, 1.2), peak(8000, 1.0, 0.9), comp(-16, 3.5, 0.003, 0.06, 6), shelfHi(15000, 1.2) ]

  let base
  switch(preset){
    case 'jazz': base = JAZZ; break
    case 'cubano': base = CUBANO; break
    case 'blues': base = BLUES; break
    case 'latin_jazz': base = LATIN; break
    case 'edm': base = EDM; break
    case 'clean':
    default: base = CLEAN
  }

  // User tone controls applied at end (agar sama dengan apa yang kamu dengar di player)
  const userLow = shelfLo(100,  tone?.bass ?? 0)
  const userMid = peak(3000,    tone?.vocal ?? 0, 1.0)
  const userHi  = shelfHi(8000, tone?.treble ?? 0)
  const master  = gain(Math.max(0, tone?.vol ?? 1))

  return [...base, userLow, userMid, userHi, master]
}
