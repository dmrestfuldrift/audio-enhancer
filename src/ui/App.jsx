// =============================================
// FILE: src/ui/App.jsx
// =============================================
import React, { useMemo, useRef, useState } from 'react'
import { enhanceArrayBuffer } from '../wasmless/dsp'
import { audioBufferToMp3, audioBufferToWav } from '../wasmless/exporters'
import JSZip from 'jszip'

const PRESETS = [
  { id:'clean', name:'Clean (Pro)', tip:'Natural, transparan, aman untuk mayoritas materi.' },
  { id:'jazz', name:'Jazz', tip:'Low-cut ringan, mid presence halus, dinamika natural.' },
  { id:'cubano', name:'Cubano', tip:'Low punch, high sparkle, kontrol sibilance.' },
  { id:'blues', name:'Blues', tip:'Body hangat, high roll-off lembut.' },
  { id:'latin_jazz', name:'Latin Jazz', tip:'Kick tight, perkusif jelas, vokal forward.' },
  { id:'edm', name:'EDM', tip:'Low-end tegas, high clarity, limiting lebih agresif.' }
]

const BITRATES = [128,160,192,256,320]

export default function App(){
  // files: [{ file, arrayBuffer, audioBuffer, name, duration }]
  const [files, setFiles] = useState([])
  const [current, setCurrent] = useState(-1)

  const [preset, setPreset] = useState('clean')
  const [format, setFormat] = useState('mp3')
  const [bitrate, setBitrate] = useState(192)

  // realtime tone controls
  const [vol, setVol] = useState(1)       // linear
  const [bass, setBass] = useState(0)     // dB (lowshelf 100 Hz)
  const [vocal, setVocal] = useState(0)   // dB (peaking 3 kHz)
  const [treble, setTreble] = useState(0) // dB (highshelf 8 kHz)

  const [running, setRunning] = useState(false)
  const [doneCount, setDoneCount] = useState(0)
  const [logs, setLogs] = useState([])

  // Media player refs
  const actxRef = useRef(null)
  const srcRef = useRef(null)
  const nodesRef = useRef(null) // {gain, low, mid, high}
  const startAtRef = useRef(0)
  const offsetRef = useRef(0)
  const playingRef = useRef(false)

  const total = files.length
  const progressPercent = useMemo(()=> total? Math.round(doneCount/total*100):0,[doneCount,total])
  function log(line){ setLogs(prev=>[...prev, line]) }

  // ---------- File load & playlist ----------
  const onPick = async (e)=>{
    const list = Array.from(e.target.files||[])
    const loaded = []
    const ac = actxRef.current || new (window.AudioContext||window.webkitAudioContext)()
    if (!actxRef.current) actxRef.current = ac

    for (const f of list){
      const ab = await f.arrayBuffer()
      const buf = await ac.decodeAudioData(ab.slice(0))
      loaded.push({ file: f, arrayBuffer: ab, audioBuffer: buf, name: f.name, duration: buf.duration })
    }
    setFiles(loaded)
    setDoneCount(0); setLogs([])
    setCurrent(loaded.length?0:-1)
  }

  // ---------- Realtime graph ----------
  function ensureGraph(){
    const ac = actxRef.current || new (window.AudioContext||window.webkitAudioContext)()
    if (!actxRef.current) actxRef.current = ac
    if (!nodesRef.current){
      const gain = ac.createGain(); gain.gain.value = vol
      const low = ac.createBiquadFilter(); low.type='lowshelf'; low.frequency.value = 100; low.gain.value = bass
      const mid = ac.createBiquadFilter(); mid.type='peaking'; mid.frequency.value = 3000; mid.Q.value = 1.0; mid.gain.value = vocal
      const high = ac.createBiquadFilter(); high.type='highshelf'; high.frequency.value = 8000; high.gain.value = treble
      // master chain: src -> low -> mid -> high -> gain -> dest
      low.connect(mid); mid.connect(high); high.connect(gain); gain.connect(ac.destination)
      nodesRef.current = { gain, low, mid, high }
    }
    return { ac, ...nodesRef.current }
  }

  function killSource(){
    try{ srcRef.current && srcRef.current.stop() }catch(_){}
    srcRef.current = null
  }

  function connectSourceFrom(buffer, offset=0){
    const { ac, low } = ensureGraph()
    const src = ac.createBufferSource()
    src.buffer = buffer
    src.connect(low)
    src.start(0, Math.max(0, Math.min(buffer.duration-0.001, offset)))
    src.onended = ()=>{ playingRef.current=false }
    srcRef.current = src
    startAtRef.current = ac.currentTime
    playingRef.current = true
  }

  // ---------- Media controls ----------
  function play(){
    if (current<0 || !files[current]) return
    connectSourceFrom(files[current].audioBuffer, offsetRef.current)
  }
  function pause(){
    if (!playingRef.current) return
    const ac = actxRef.current
    const buf = files[current]?.audioBuffer
    const elapsed = ac.currentTime - startAtRef.current
    offsetRef.current = Math.min((offsetRef.current||0) + elapsed, buf?.duration||0)
    killSource()
  }
  function stop(){ offsetRef.current = 0; killSource() }
  function pick(index){ stop(); setCurrent(index); }

  // ---------- Live update nodes on slider move ----------
  useMemo(()=>{ if (nodesRef.current) nodesRef.current.gain.gain.value = vol }, [vol])
  useMemo(()=>{ if (nodesRef.current) nodesRef.current.low.gain.value = bass }, [bass])
  useMemo(()=>{ if (nodesRef.current) nodesRef.current.mid.gain.value = vocal }, [vocal])
  useMemo(()=>{ if (nodesRef.current) nodesRef.current.high.gain.value = treble }, [treble])

  // ---------- Batch process (respect tone sliders) ----------
  async function processOne(fileObj){
    const enhanced = await enhanceArrayBuffer(fileObj.arrayBuffer, {
      preset,
      targetSampleRate: 48000,
      tone: { vol, bass, vocal, treble },
    })
    if (format==='mp3'){
      const blob = await audioBufferToMp3(enhanced, bitrate)
      return { blob, ext: '.mp3' }
    } else {
      const blob = audioBufferToWav(enhanced)
      return { blob, ext: '.wav' }
    }
  }

  async function run(){
    if(!files.length) return
    setRunning(true); setDoneCount(0); setLogs([])
    const downloads = document.getElementById('downloads'); if (downloads) downloads.innerHTML = ''

    for (let i=0;i<files.length;i++){
      const f = files[i]
      try{
        log(`▶️ ${i+1}/${files.length} ${f.name} …`)
        const { blob, ext } = await processOne(f)
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        const base = f.name.replace(/\.[^.]+$/, '')
        const suffix = format==='mp3'? `_enhanced_${bitrate}kbps` : `_enhanced`
        a.download = base + suffix + ext
        a.textContent = `Download ${a.download}`
        a.className = 'link'
        downloads.appendChild(a)
        downloads.appendChild(document.createElement('br'))
        setDoneCount(x=>x+1)
        log(`✅ Selesai: ${f.name}`)
      }catch(err){
        console.error(err)
        log(`❌ Gagal: ${f.name} — ${err.message||err}`)
      }
    }

    setRunning(false)
  }

  async function downloadAllZip(){
    const downloads = document.getElementById('downloads')
    if (!downloads) return
    const anchors = Array.from(downloads.querySelectorAll('a[href^="blob:"]'))
    if (!anchors.length){ log('ℹ️ Belum ada hasil untuk di-zip. Klik Process dulu.'); return }

    const zip = new JSZip()
    for (const a of anchors){
      const resp = await fetch(a.href)
      const blob = await resp.blob()
      const name = a.download || a.textContent || `file_${Date.now()}`
      zip.file(name, blob)
    }
    const zipBlob = await zip.generateAsync({ type:'blob' })
    const url = URL.createObjectURL(zipBlob)
    const dl = document.createElement('a')
    dl.href = url; dl.download = 'enhanced_audios.zip'; dl.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="container">
      <div className="h1">Audio Enhancer Web — Professional & User-Friendly</div>

      <div className="card" style={{marginBottom:16}}>
        <div className="row" style={{alignItems:'center'}}>
          <input className="input" type="file" multiple accept="audio/*" onChange={onPick} />

          <select value={preset} onChange={e=>setPreset(e.target.value)}>
            {PRESETS.map(p=> <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <select value={format} onChange={e=>setFormat(e.target.value)}>
            <option value="mp3">MP3</option>
            <option value="wav">WAV (PCM 16-bit)</option>
          </select>

          {format==='mp3' && (
            <select value={bitrate} onChange={e=>setBitrate(parseInt(e.target.value))}>
              {BITRATES.map(b=> <option key={b} value={b}>{b} kbps</option>)}
            </select>
          )}

          {!running && <button className="primary" onClick={run} disabled={!files.length}>Process</button>}
          {running && <button className="secondary" disabled>Processing…</button>}
          <button className="secondary" onClick={downloadAllZip}>Download All (ZIP)</button>
        </div>

        <hr/>

        {/* Realtime controls */}
        <div className="grid">
          <div className="col-12">
            <div className="small" style={{marginBottom:6}}>Realtime Controls (berlaku ke media player & proses)</div>
            <div className="row">
              <label className="badge small" style={{gap:8}}>Vol
                <input type="range" min="0" max="2" step="0.01" value={vol} onChange={e=>setVol(parseFloat(e.target.value))} />
                <span>{vol.toFixed(2)}×</span>
              </label>
              <label className="badge small" style={{gap:8}}>Bass
                <input type="range" min="-12" max="12" step="0.1" value={bass} onChange={e=>setBass(parseFloat(e.target.value))} />
                <span>{bass.toFixed(1)} dB</span>
              </label>
              <label className="badge small" style={{gap:8}}>Vocal
                <input type="range" min="-12" max="12" step="0.1" value={vocal} onChange={e=>setVocal(parseFloat(e.target.value))} />
                <span>{vocal.toFixed(1)} dB</span>
              </label>
              <label className="badge small" style={{gap:8}}>Treble
                <input type="range" min="-12" max="12" step="0.1" value={treble} onChange={e=>setTreble(parseFloat(e.target.value))} />
                <span>{treble.toFixed(1)} dB</span>
              </label>
            </div>
          </div>
        </div>

        <hr/>

        {/* Media player & playlist */}
        <div className="grid">
          <div className="col-6">
            <div className="small" style={{marginBottom:6}}>Playlist</div>
            <div className="filelist" style={{maxHeight:210,overflow:'auto'}}>
              {files.map((f,i)=> (
                <div
                  key={i}
                  className="fileitem"
                  style={{borderColor: i===current? '#3aa675' : undefined, cursor:'pointer'}}
                  onClick={()=>pick(i)}
                >
                  {i===current? '▶ ' : ''}{f.name}
                </div>
              ))}
            </div>
          </div>
          <div className="col-6">
            <div className="small" style={{marginBottom:6}}>Media Player</div>
            <div className="row">
              <button className="primary" onClick={play} disabled={current<0}>Play</button>
              <button className="secondary" onClick={pause} disabled={current<0}>Pause</button>
              <button className="secondary" onClick={stop} disabled={current<0}>Stop</button>
            </div>
            <div className="small" style={{marginTop:8}}>
              {current>=0? `${files[current].name} — ${files[current].duration.toFixed(1)}s` : 'No track selected'}
            </div>
            <div className="small" style={{marginTop:8}}>Downloads</div>
            <div id="downloads" style={{maxHeight:210,overflow:'auto',marginTop:6}}></div>
          </div>
        </div>

        <hr/>
        <div className="small" style={{marginBottom:6}}>Progress</div>
        <div className="progress"><span style={{width: progressPercent+'%'}}></span></div>
        <div className="small" style={{marginTop:6}}>{doneCount}/{total} — {progressPercent}%</div>

        <hr/>
        <div className="small" style={{marginBottom:6}}>Logs</div>
        <div style={{
          maxHeight:160,overflow:'auto',
          fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize:12,background:'#0e141b',border:'1px solid #1f2a38',borderRadius:10,padding:10
        }}>
          {logs.map((l,idx)=> <div key={idx}>{l}</div>)}
        </div>
      </div>

      <div className="small">Tips: Gunakan input WAV/FLAC untuk konsistensi; atur slider saat lagu diputar untuk dengar perubahan realtime.</div>
    </div>
  )
}
