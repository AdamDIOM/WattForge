import React, { useEffect, useState, useMemo, useRef, useContext } from 'react'
import CitySelector from './CitySelector'
import ForecastChart from './ForecastChart'

function UploadsAccordion({ uploadsList, setUploadsList, setPreviewRows, setUploadSummary, setToast, fetchTrainingStatus }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border rounded-md bg-white">
      <button
        type="button"
        onClick={async ()=>{
          // Toggle state; on first open refresh list
          const next = !open
          setOpen(next)
          if (next && !uploadsList) {
            try { const r = await fetch('/api/uploads'); const j = await r.json(); setUploadsList(j.uploads) } catch (e) { setToast({ type: 'error', text: 'Failed to fetch uploads' }) }
          }
        }}
        className="w-full flex items-center justify-between px-4 py-3 text-left font-medium text-slate-700 hover:bg-slate-50 transition"
      >
        <span>Past Uploads</span>
        <span className={`text-xs px-2 py-1 rounded ${uploadsList ? 'bg-nordic-100 text-nordic-700' : 'bg-slate-100 text-slate-600'}`}>{uploadsList ? uploadsList.length : 0}</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <div className="flex gap-2 mb-3">
            <button className="px-2 py-1 bg-white border rounded text-xs" onClick={async ()=>{
              try { const r = await fetch('/api/uploads'); const j = await r.json(); setUploadsList(j.uploads); setToast({ type: 'success', text: 'Uploads refreshed' }) } catch (e) { setToast({ type: 'error', text: 'Refresh failed' }) }
            }}>Refresh</button>
          </div>
      <div className="max-h-64 overflow-auto text-sm space-y-3">
            {uploadsList && uploadsList.length > 0 ? uploadsList.map(u => (
        <div key={u.filename} className={`border rounded p-3 flex flex-col gap-2 ${u.isLoading ? 'bg-nordic-50' : 'bg-slate-50'}`}> {/* container */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium truncate" title={u.originalname}>{u.originalname}</div>
                    <div className="text-xs text-slate-500">{u.uploadedAt}</div>
                  </div>
                  <div className="flex gap-2">
                    <button className="px-2 py-1 bg-white border rounded text-xs" onClick={async ()=>{
                      const r = await fetch(`/api/upload-preview?name=${encodeURIComponent(u.filename)}&sheet=training_consumption&rows=6`)
                      const j = await r.json(); setPreviewRows(j.preview)
                    }}>Consumption</button>
                    <button className="px-2 py-1 bg-white border rounded text-xs" onClick={async ()=>{
                      const r = await fetch(`/api/upload-preview?name=${encodeURIComponent(u.filename)}&sheet=training_prices&rows=6`)
                      const j = await r.json(); setPreviewRows(j.preview)
                    }}>Prices</button>
                    <LoadButton u={u} />
                  </div>
                </div>
                {u.summary && (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-white rounded p-1 text-center"><div className="font-semibold">P</div><div>{u.summary.prices_rows}</div></div>
                    <div className="bg-white rounded p-1 text-center"><div className="font-semibold">C</div><div>{u.summary.consumption_rows}</div></div>
                    <div className="bg-white rounded p-1 text-center"><div className="font-semibold">G</div><div>{u.summary.groups_rows}</div></div>
                  </div>
                )}
              </div>
            )) : <div className="text-xs text-slate-500">No uploads yet.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function LoadButton({ u }) {
  const { loadedFilename, loadingDataset, setLoadingDataset, setUploadSummary, setToast, fetchTrainingStatus } = useAppContext()
  const isLoaded = loadedFilename === u.filename
  const isLoading = loadingDataset === u.filename
  const disabled = loadingDataset && loadingDataset !== u.filename
  const baseClasses = 'px-2 py-1 rounded text-xs border transition'
  let style = 'bg-nordic-500 text-white border-nordic-600 hover:bg-nordic-600'
  if (isLoaded) style = 'bg-emerald-500 text-white border-emerald-600 cursor-default'
  if (disabled) style = 'bg-slate-200 text-slate-500 border-slate-300 cursor-not-allowed'
  if (isLoading) style = 'bg-nordic-500 text-white border-nordic-600 animate-pulse'
  return (
    <button disabled={disabled || isLoaded} className={`${baseClasses} ${style}`} onClick={async ()=>{
      if (disabled || isLoaded) return
      try {
        setLoadingDataset(u.filename)
        const r = await fetch(`/api/load-upload?name=${encodeURIComponent(u.filename)}`)
        const j = await r.json()
        if (r.ok) { setUploadSummary(u.summary); setToast({ type: 'success', text: 'Loaded dataset' }); fetchTrainingStatus() }
        else { setToast({ type: 'error', text: 'Load failed: ' + (j.error || 'unknown') }) }
      } catch (e) {
        setToast({ type: 'error', text: 'Load error: ' + e.message })
      } finally {
        setLoadingDataset(null)
      }
    }}>{isLoaded ? 'Loaded' : (isLoading ? 'Loading…' : 'Load')}</button>
  )
}

// Basic context hook to provide needed setters/state to LoadButton without prop drilling
const AppContext = React.createContext(null)
function useAppContext() { return useContext(AppContext) }

function Header({ loadedFilename }) {
  return (
    <header className="site-header">
      <div className="container flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-nordic-500 flex items-center justify-center text-white">
            {/* simple bolt SVG */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M13 2L3 14h7l-1 8L21 10h-7l-1-8z" fill="currentColor" />
            </svg>
          </div>
          <div className="text-lg font-semibold">WattForge</div>
        </div>
        <nav className="hidden md:flex gap-6 text-slate-700">
          <button id="aboutBtn" className="hover:text-nordic-500" onClick={(e)=>{ const ev = new CustomEvent('openAbout'); window.dispatchEvent(ev) }}>About</button>
        </nav>
        <div className="hidden md:flex items-center ml-4">
          {loadedFilename ? (
            <div className="text-sm text-slate-700 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
              <span title={loadedFilename} className="truncate max-w-xs">Loaded: <strong>{loadedFilename}</strong></span>
            </div>
          ) : (
            <div className="text-sm text-slate-400">No dataset loaded</div>
          )}
        </div>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container py-6 text-center text-sm text-slate-600">
  <div>Made with ❤️ — WattForge demo</div>
  <div className="mt-2">© {new Date().getFullYear()} WattForge</div>
      </div>
    </footer>
  )
}

export default function App() {
  const [aboutOpen, setAboutOpen] = useState(false)
  const [aboutVisible, setAboutVisible] = useState(false) // controls transition
  const lastFocusedRef = useRef(null)
  const modalRef = useRef(null)

  useEffect(()=>{
    const handler = ()=>{
      // store last focused element to restore focus on close
      lastFocusedRef.current = document.activeElement
      setAboutOpen(true)
      // allow mount then trigger visible for transition
      requestAnimationFrame(()=> setAboutVisible(true))
    }
    window.addEventListener('openAbout', handler)
    return ()=>window.removeEventListener('openAbout', handler)
  }, [])

  // close helper with transition
  function closeAbout() {
    setAboutVisible(false)
    // wait for transition to finish before unmounting
    setTimeout(()=>{
      setAboutOpen(false)
      // restore focus
      try { if (lastFocusedRef.current && lastFocusedRef.current.focus) lastFocusedRef.current.focus() } catch (e) {}
    }, 220)
  }

  // accessibility: trap focus and handle Escape
  useEffect(()=>{
    if (!aboutOpen) return
    // lock body scroll
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeAbout()
        return
      }
      if (e.key === 'Tab') {
        // focus trap
        const container = modalRef.current
        if (!container) return
        const focusable = container.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])')
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus() }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus() }
        }
      }
    }

    document.addEventListener('keydown', onKey)
    // move focus into modal
    requestAnimationFrame(()=>{
      const container = modalRef.current
      if (container) {
        const focusable = container.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])')
        if (focusable.length) focusable[0].focus()
        else container.focus()
      }
    })

    return ()=>{
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [aboutOpen])
  const [message, setMessage] = useState('Loading...')
  const [coords, setCoords] = useState(null)
  const [ev, setEv] = useState(10)
  const [forecast, setForecast] = useState(null)
  const [weather, setWeather] = useState(null)
  const [countryInfo, setCountryInfo] = useState(null)
  const [evSource, setEvSource] = useState(null)
  const [uploadSummary, setUploadSummary] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadsList, setUploadsList] = useState(null)
  const [previewRows, setPreviewRows] = useState(null)
  const [trainingResult, setTrainingResult] = useState(null)
  // Add hyperTraining state
  const [hyperTraining, setHyperTraining] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)
  const [loadedFilename, setLoadedFilename] = useState(null)
  const UNIT = 'FWh'
  const [showDirectPredictions, setShowDirectPredictions] = useState(false)
  const [combinedStats, setCombinedStats] = useState(null)
  // Track whether THIS browser tab performed an upload during current session
  const [hasUploadedThisSession, setHasUploadedThisSession] = useState(false)
  const [selectedUploadFile, setSelectedUploadFile] = useState(null)
  const [loadingDataset, setLoadingDataset] = useState(null)
  // Prediction start datetime (local) for CSV exports
  const [startLocal, setStartLocal] = useState(()=>{
    const d = new Date();
    d.setSeconds(0,0)
    const pad = (n)=> String(n).padStart(2,'0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [analysisAnswer, setAnalysisAnswer] = useState('')
  const [showAnalysisRaw, setShowAnalysisRaw] = useState(false)

  function localToIsoUTC(localStr) {
    if (!localStr) return ''
    // localStr like 2025-01-15T12:00
    const d = new Date(localStr)
    const iso = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0, 0)).toISOString()
    return iso
  }

  const forecastStats = useMemo(() => {
    if (!forecast || forecast.length === 0) return null
    const values = forecast.map(f => f.value)
    const sum = values.reduce((a,b)=>a+b,0)
    const avg = Math.round(sum / values.length)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const peakIdx = values.indexOf(max)
    const peakTime = forecast[peakIdx] ? forecast[peakIdx].time : null
    return { avg, min, max, peakTime }
  }, [forecast])

  function fetchForecast(lat, lon, evPct) {
    fetch(`/api/forecast?lat=${lat}&lon=${lon}&ev=${evPct}&hours=48`)
      .then(r => r.json())
  .then(d => setForecast(d.forecast))
      .catch(() => setForecast(null))
  }

  function fetchWeather(lat, lon) {
    fetch(`/api/weather?lat=${lat}&lon=${lon}`)
      .then(r => r.json())
      .then(d => setWeather(d.data))
      .catch(() => setWeather(null))
  }

  useEffect(() => {
    fetch('/api/hello')
      .then(r => r.json())
      .then(d => setMessage(d.message))
      .catch(() => setMessage('Could not reach API'))

    // try to get geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((p) => {
        const lat = p.coords.latitude
        const lon = p.coords.longitude
        setCoords({ lat, lon })
        fetchWeather(lat, lon)
        fetchForecast(lat, lon, ev)
        // fetch estimated EV uptake
        fetch(`/api/ev?lat=${lat}&lon=${lon}`)
          .then(r => r.json())
          .then(d => { if (d.ev !== undefined) setEv(d.ev) })
          .catch(() => {})
  // fetch reverse geocode and source suggestions
  fetch(`/api/reverse?lat=${lat}&lon=${lon}`).then(r=>r.json()).then(d=>setCountryInfo(d)).catch(()=>{})
  fetch(`/api/evsource?lat=${lat}&lon=${lon}`).then(r=>r.json()).then(d=>setEvSource(d)).catch(()=>{})
      }, () => {
        // default to Helsinki coordinates
        const lat = 60.1699
        const lon = 24.9384
        setCoords({ lat, lon })
        fetchWeather(lat, lon)
        fetchForecast(lat, lon, ev)
        fetch(`/api/ev?lat=${lat}&lon=${lon}`)
          .then(r => r.json())
          .then(d => { if (d.ev !== undefined) setEv(d.ev) })
          .catch(() => {})
  fetch(`/api/reverse?lat=${lat}&lon=${lon}`).then(r=>r.json()).then(d=>setCountryInfo(d)).catch(()=>{})
  fetch(`/api/evsource?lat=${lat}&lon=${lon}`).then(r=>r.json()).then(d=>setEvSource(d)).catch(()=>{})
      })
    }
  }, [])

  // Poll training status (loaded filename)
  async function fetchTrainingStatus() {
    try {
      const r = await fetch('/api/check-training')
      if (!r.ok) { setLoadedFilename(null); return }
      const j = await r.json()
      setLoadedFilename(j && j.filename ? j.filename : null)
    } catch (e) { setLoadedFilename(null) }
  }

  useEffect(() => {
    fetchTrainingStatus()
    const id = setInterval(fetchTrainingStatus, 10000)
    return () => clearInterval(id)
  }, [])

  // Toast lifecycle: auto-dismiss after 10s with fade-out
  useEffect(() => {
    if (toast) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      toastTimerRef.current = setTimeout(() => {
        setToast(t => t ? { ...t, closing: true } : null)
        setTimeout(() => setToast(null), 400) // allow transition
      }, 10000)
    }
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current) }
  }, [toast])

  return (
    <AppContext.Provider value={{ loadedFilename, loadingDataset, setLoadingDataset, setUploadSummary, setToast, fetchTrainingStatus }}>
    <div className="min-h-screen flex flex-col">
      <Header loadedFilename={loadedFilename} />
      {/* About modal */}
      {aboutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="aboutTitle">
          <div className={`fixed inset-0 bg-black/50 transition-opacity ${aboutVisible ? 'opacity-100' : 'opacity-0'}`} onClick={closeAbout} />
          <div ref={modalRef} className={`bg-white rounded-lg shadow-xl max-h-[80vh] overflow-hidden transform transition-all ${aboutVisible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-3'}`} style={{ width: 'min(90%, 50%)', zIndex: 60 }}>
            <div className="p-4 border-b flex items-center justify-between">
              <div id="aboutTitle" className="text-lg font-semibold">About WattForge</div>
              <button className="text-slate-600" onClick={closeAbout}>Close</button>
            </div>
            <div className="p-4 overflow-auto text-sm" style={{ maxHeight: 'calc(80vh - 72px)' }} tabIndex={-1}>
              <p className="mb-2">WattForge helps you forecast energy usage and explore insights.</p>
              <ul className="list-disc ml-5 mb-2">
                <li>Upload a workbook with consumption, prices, and groups.</li>
                <li>Get 48‑hour and 12‑month forecasts in FortumWattHours (FWh), with downloadable CSVs.</li>
                <li>Use <strong>Hyper Train</strong> to enhance per‑group forecasts with AI and view a clear summary card.</li>
                <li>Ask questions in the analysis panel and receive concise, readable answers.</li>
              </ul>
              <p className="mb-2">Your data is used solely to create forecasts and insights for you. You can remove uploaded files at any time.</p>
              <p className="text-xs text-slate-500 mt-4">Close this box to continue. Content scrolls if it exceeds the visible area.</p>
            </div>
          </div>
        </div>
      )}

      <main className="flex-grow container py-12">
        {/* Hero / Challenge banner */}
        <div className="bg-gradient-to-r from-nordic-100 to-white rounded-lg p-8 mb-8 shadow">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-nordic-800">Watt's next?</h1>
              <p className="mt-2 text-slate-700 max-w-2xl">A focused demo: upload training data, run forecasts, and experiment with AI-driven synthetic generation.</p>
            </div>
            <div className="md:w-1/3 bg-white rounded-lg p-4 shadow">
              <div className="text-sm font-medium text-slate-600">Project</div>
              <div className="mt-1 font-semibold">Forecasting demo</div>
              <div className="text-xs text-slate-500 mt-2">Use the panels to upload training workbooks, run forecasts, and test AI generation.</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <section className="md:col-span-2 bg-white rounded-lg shadow p-6">
            <h2 className="text-2xl font-semibold mb-3">Welcome to WattForge</h2>
            <p className="text-slate-700 mb-4">An integrated forecasting and analytics interface.</p>
            {/* Removed API message box for production feel */}

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded bg-white border">
                <div className="text-sm font-medium">Location</div>
                <div className="mt-2 text-sm text-slate-600">{coords ? `${coords.lat.toFixed(3)}, ${coords.lon.toFixed(3)}` : 'Unknown'}</div>
                <div className="mt-3">
                  <label className="block text-sm">Choose city / search</label>
                  <CitySelector onSelect={(lat, lon) => { setCoords({ lat, lon }); fetchWeather(lat, lon); fetchForecast(lat, lon, ev); }} />
                </div>
              </div>

              <div className="p-4 rounded bg-white border">
                <div className="text-sm font-medium">EV uptake</div>
                <div className="mt-2 text-sm text-slate-600">Adjust assumed EV penetration in the region</div>
                <div className="mt-3 flex items-center gap-3">
                  <input type="range" min="0" max="100" value={ev} onChange={(e) => setEv(Number(e.target.value))} />
                  <div className="w-12 text-right">{ev}%</div>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <h3 className="text-lg font-semibold">Upload training workbook</h3>
              <p className="text-sm text-slate-600">Upload an Excel workbook with sheets: <code>training_prices</code>, <code>training_consumption</code>, and <code>groups</code>.</p>
                <div className="mt-2 flex items-center gap-3">
                <div className="relative">
                  <input id="trainingFile" type="file" accept=".xls,.xlsx" className="sr-only" onChange={(e)=>{
                    const f = e.target.files && e.target.files[0]
                    setSelectedUploadFile(f || null)
                    const label = document.getElementById('trainingFileLabel')
                    if (label) label.textContent = f ? f.name : 'Choose file'
                  }} />
                  <label htmlFor="trainingFile" className="px-3 py-2 cursor-pointer rounded bg-white border text-sm font-medium hover:bg-nordic-50 transition" id="trainingFileLabel">Choose file</label>
                </div>
                {selectedUploadFile && (
                <button className="px-3 py-2 bg-nordic-500 text-white rounded shadow-sm hover:bg-nordic-600 transition" onClick={async () => {
                  const el = document.getElementById('trainingFile')
                  if (!el || !el.files || el.files.length === 0) return alert('Select a file first')
                  const file = el.files[0]
                  const fd = new FormData()
                  fd.append('file', file)
                  setUploading(true)
                  try {
                    const resp = await fetch('/api/upload-training', { method: 'POST', body: fd })
                    const j = await resp.json()
                    if (!resp.ok) throw new Error(j.error || 'Upload failed')
                    setUploadSummary(j.summary)
                    setToast({ type: 'success', text: 'Upload successful' })
                    fetchTrainingStatus()
                    setHasUploadedThisSession(true)
                    setSelectedUploadFile(null)
                    const label = document.getElementById('trainingFileLabel'); if (label) label.textContent = 'Choose file'
                  } catch (err) {
                    setToast({ type: 'error', text: 'Upload failed: ' + (err.message || err) })
                  } finally { setUploading(false) }
                }}>{uploading ? 'Uploading...' : 'Upload'}</button>
                )}
              </div>
              {uploadSummary && (
                <div className="mt-3 p-3 bg-nordic-50 border rounded text-sm">
                  <div>Prices rows: <strong>{uploadSummary.prices_rows}</strong></div>
                  <div>Consumption rows: <strong>{uploadSummary.consumption_rows}</strong></div>
                  <div>Groups rows: <strong>{uploadSummary.groups_rows}</strong></div>
                  <div className="mt-2">
                    <div className="flex gap-2">
                      <button
                        className={`px-3 py-1 rounded text-white ${hyperTraining ? 'bg-nordic-500 animate-pulse cursor-wait' : 'bg-nordic-500 hover:bg-nordic-600'} disabled:opacity-60`}
                        disabled={hyperTraining}
                        onClick={async ()=>{
                          if (hyperTraining) return
                          try {
                            setHyperTraining(true)
                            const payload = { lat: coords?.lat, lon: coords?.lon, ev, forecast }
                            const resp = await fetch('/api/hyper-train', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
                            const j = await resp.json()
                            setTrainingResult(j)
                            if (resp.ok) setToast({ type: 'success', text: 'Hyper train complete' })
                            else setToast({ type: 'error', text: j.error || 'Hyper train failed' })
                          } catch (e) {
                            setToast({ type: 'error', text: 'Hyper train error: ' + e.message })
                          } finally {
                            setHyperTraining(false)
                          }
                        }}
                      >{hyperTraining ? 'Hyper training…' : 'Hyper Train (AI blend)'}</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4">
              {/* Accordion for past uploads */}
              <UploadsAccordion uploadsList={uploadsList} setUploadsList={setUploadsList} setPreviewRows={setPreviewRows} setUploadSummary={setUploadSummary} setToast={setToast} fetchTrainingStatus={fetchTrainingStatus} />
              {previewRows && (
                <div className="mt-2 bg-slate-50 border p-2 rounded text-xs overflow-auto">
                  <pre className="whitespace-pre-wrap">{JSON.stringify(previewRows, null, 2)}</pre>
                </div>
              )}
              {trainingResult && (
                <div className="mt-2 bg-green-50 border p-2 rounded text-sm">
                  <div className="font-medium">Training result</div>
                  <div className="mt-2 bg-white border rounded-md p-3 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold">Hyper Forecast Summary</div>
                      <div className="text-xs text-slate-500">{new Date().toLocaleTimeString()}</div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <Stat label="Groups parsed" value={(trainingResult.hourly_forecast_groups && Object.keys(trainingResult.hourly_forecast_groups).length) || 0} />
                      <Stat label="Hourly points" value={trainingResult.generated ? trainingResult.generated.length : (trainingResult.hourly_forecast_groups ? (trainingResult.hourly_forecast_groups[Object.keys(trainingResult.hourly_forecast_groups)[0]]||[]).length : 0)} />
                      <Stat label="Monthly span" value={trainingResult.monthly_forecast_groups ? 12 : 0} />
                      <Stat label="Has analysis" value={trainingResult.analysis ? 'Yes' : 'No'} />
                    </div>
                    {/* Derived stats */}
                    <DerivedStats trainingResult={trainingResult} unit={UNIT} />
                  </div>
                  {trainingResult.generated ? (
                    <div className="mt-4 max-h-48 overflow-auto text-xs">
                      <table className="w-full text-left">
                        <thead>
                          <tr><th className="pr-2">Time</th><th>Value ({UNIT})</th></tr>
                        </thead>
                        <tbody>
                          {trainingResult.generated.slice(0,24).map((row,i)=>(
                            <tr key={i}><td className="pr-2">{row.time}</td><td>{row.value} {UNIT}</td></tr>
                          ))}
                        </tbody>
                      </table>
                      {trainingResult.generated.length > 24 && <div className="mt-1">… +{trainingResult.generated.length-24} more rows</div>}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              )}
            </div>

            <div className="mt-6">
              <h3 className="text-lg font-semibold">Forecast visualization</h3>
              {forecast ? <ForecastChart data={forecast} /> : <div className="text-sm text-slate-500 mt-2">Run a forecast to see a chart</div>}
              {!hasUploadedThisSession && (
                <p className="mt-2 text-xs text-slate-500 italic">Disclaimer: Forecast uses previously uploaded training data structure (if any) plus synthetic logic; it may be inaccurate for your specific assets.</p>
              )}
            </div>

            <div className="mt-6">
              <h3 className="text-lg font-semibold">Export predictions (CSV)</h3>
              <p className="text-sm text-slate-600">Generate synthetic hourly (48 records) and monthly (12 records) prediction CSVs matching example format.</p>
              {!hasUploadedThisSession && (
                <p className="mt-1 text-xs text-slate-500 italic">Disclaimer: Generated prediction CSVs are synthetic and rely on the previously uploaded training workbook (filename: {loadedFilename || 'none'}) for column structure; values are illustrative only.</p>
              )}
              <div className="mt-3 flex flex-col md:flex-row md:items-end gap-3">
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Start at (date & time)</label>
                  <input type="datetime-local" value={startLocal} onChange={(e)=>setStartLocal(e.target.value)} className="border rounded px-2 py-1 text-sm" />
                </div>
                <div className="flex gap-2">
        <button className="px-3 py-2 bg-nordic-500 text-white rounded" onClick={async () => {
                  try {
                    const startIso = localToIsoUTC(startLocal)
                    const r = await fetch(`/api/predict-csv?start=${encodeURIComponent(startIso)}`)
                    const j = await r.json()
                    if (!r.ok) throw new Error(j.error || 'Failed')
                    // hourly download
                    const hourlyBlob = new Blob([j.hourly_csv], { type: 'text/csv' })
                    const hourlyUrl = URL.createObjectURL(hourlyBlob)
                    const a1 = document.createElement('a'); a1.href = hourlyUrl; a1.download = 'prediction_hourly.csv'; a1.click(); URL.revokeObjectURL(hourlyUrl)
                    // monthly download
                    const monthlyBlob = new Blob([j.monthly_csv], { type: 'text/csv' })
                    const monthlyUrl = URL.createObjectURL(monthlyBlob)
                    const a2 = document.createElement('a'); a2.href = monthlyUrl; a2.download = 'prediction_monthly.csv'; a2.click(); URL.revokeObjectURL(monthlyUrl)
                    setToast({ type: 'success', text: 'Exported hourly & monthly CSVs' })
          setShowDirectPredictions(true)
                  } catch (e) {
                    setToast({ type: 'error', text: 'Export failed: ' + e.message })
                  }
                }}>Generate & Download</button>
        {showDirectPredictions && (
        <button className="px-3 py-2 bg-white border rounded" onClick={async () => {
                  // direct endpoints (hourly & monthly) sequentially
                  try {
          const startIso = localToIsoUTC(startLocal)
          const hr = await fetch(`/api/predict-hourly.csv?start=${encodeURIComponent(startIso)}`)
                    const hourlyText = await hr.text()
                    if (hr.ok) {
                      const hb = new Blob([hourlyText], { type: 'text/csv' })
                      const hu = URL.createObjectURL(hb)
                      const a = document.createElement('a'); a.href = hu; a.download = 'prediction_hourly.csv'; a.click(); URL.revokeObjectURL(hu)
                    }
          const mr = await fetch(`/api/predict-monthly.csv?start=${encodeURIComponent(startIso)}`)
                    const monthlyText = await mr.text()
                    if (mr.ok) {
                      const mb = new Blob([monthlyText], { type: 'text/csv' })
                      const mu = URL.createObjectURL(mb)
                      const a = document.createElement('a'); a.href = mu; a.download = 'prediction_monthly.csv'; a.click(); URL.revokeObjectURL(mu)
                    }
                    setToast({ type: 'success', text: 'Downloaded direct CSV endpoints' })
                  } catch (e) {
                    setToast({ type: 'error', text: 'Direct download failed: ' + e.message })
                  }
        }}>Direct endpoints</button>
        )}
        </div>
              </div>
            </div>

            <div className="mt-6">
              <h3 className="text-lg font-semibold">AI analysis</h3>
              <p className="text-sm text-slate-600">Ask the model for insights about your uploaded data and scenario.</p>
              <div className="mt-2 flex gap-3 items-center text-xs">
                <label className="flex items-center gap-1">
                  <span>Question style:</span>
                  <select id="answerStyle" className="border rounded px-2 py-1 text-xs bg-white">
                    <option value="structured">Structured</option>
                    <option value="direct">Direct</option>
                  </select>
                </label>
              </div>
              <textarea id="aiPrompt" rows={3} className="w-full p-2 border rounded mt-2" defaultValue={`Summarize the next 48 hours consumption forecast and important drivers.`} />
              <div className="mt-2 flex gap-2 items-center">
                <button disabled={analyzing} className="px-3 py-2 bg-nordic-500 text-white rounded disabled:opacity-60" onClick={async () => {
                  const prompt = document.getElementById('aiPrompt').value
                  if (!coords) { setToast({ type: 'error', text: 'No location set yet' }); return }
                  setAnalyzing(true)
                  setAnalysisResult(null)
                  setAnalysisAnswer('')
                  try {
                    const style = document.getElementById('answerStyle').value
                    const body = { lat: coords.lat, lon: coords.lon, ev, hours: 48, extraNotes: prompt, answerStyle: style }
                    const resp = await fetch('/api/analyze-training?format=text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                    const j = await resp.json()
                    if (!resp.ok) throw new Error(j.error || 'Analysis failed')
                    setAnalysisAnswer(j.answer || '')
                    setAnalysisResult(j)
                    setToast({ type: 'success', text: 'Analysis ready' })
                  } catch (e) {
                    setToast({ type: 'error', text: e.message })
                  } finally {
                    setAnalyzing(false)
                  }
                }}>{analyzing ? 'Analyzing…' : 'Analyze'}</button>
                <button className="px-3 py-2 bg-white border rounded" onClick={async () => {
                  if (!coords) { setToast({ type: 'error', text: 'No location set yet' }); return }
                  try {
                    const url = `/api/combined-stats?lat=${coords.lat}&lon=${coords.lon}&ev=${ev}`
                    const r = await fetch(url)
                    const j = await r.json()
                    if (!r.ok) throw new Error(j.error || 'Failed combined stats')
                    setCombinedStats(j)
                    setToast({ type: 'success', text: 'Combined stats generated' })
                  } catch (e) {
                    setToast({ type: 'error', text: e.message })
                  }
                }}>Generate integrated stats</button>
              </div>
              {analysisAnswer && (
                <div className="mt-3 bg-white border rounded p-3 text-sm">
                  <div className="font-medium mb-1">AI analysis</div>
                  <div className="prose prose-sm max-w-none whitespace-pre-wrap">{analysisAnswer}</div>
                  {analysisResult && (
                    <div className="mt-2 text-xs text-slate-500">
                      <button className="underline" onClick={()=>setShowAnalysisRaw(s=>!s)}>{showAnalysisRaw ? 'Hide details' : 'Show details'}</button>
                      {showAnalysisRaw && (
                        <pre className="mt-2 bg-slate-50 border rounded p-2 overflow-auto">{JSON.stringify(analysisResult, null, 2)}</pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            {combinedStats && (
              <div className="mt-6 bg-slate-50 border rounded p-4">
                <h3 className="text-lg font-semibold mb-2">Integrated scenario statistics</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  <div><div className="text-xs uppercase text-slate-500">Training avg</div><div className="font-medium">{combinedStats.stats.training_avg} {combinedStats.stats.unit}</div></div>
                  <div><div className="text-xs uppercase text-slate-500">Training min</div><div className="font-medium">{combinedStats.stats.training_min} {combinedStats.stats.unit}</div></div>
                  <div><div className="text-xs uppercase text-slate-500">Training max</div><div className="font-medium">{combinedStats.stats.training_max} {combinedStats.stats.unit}</div></div>
                  <div><div className="text-xs uppercase text-slate-500">Peak hour (hist)</div><div className="font-medium">{combinedStats.stats.peak_hour_training}:00</div></div>
                  <div><div className="text-xs uppercase text-slate-500">Heating factor</div><div className="font-medium">{combinedStats.stats.heating_factor}</div></div>
                  <div><div className="text-xs uppercase text-slate-500">EV night load idx</div><div className="font-medium">{combinedStats.stats.ev_night_load_index}</div></div>
                </div>
                <div className="mt-4 text-sm">
                  <div className="font-medium mb-1">Drivers</div>
                  <ul className="list-disc ml-5">
                    {combinedStats.drivers.map((d,i)=>(<li key={i}>{d}</li>))}
                  </ul>
                </div>
                <div className="mt-4 text-sm">
                  <div className="font-medium mb-1">Recommendations</div>
                  <ul className="list-disc ml-5">
                    {combinedStats.recommendations.map((r,i)=>(<li key={i}>{r}</li>))}
                  </ul>
                </div>
                <div className="mt-4 text-sm">
                  <div className="font-medium mb-1">Forward 48h (first 12 shown)</div>
                  <ul className="text-xs space-y-1 max-h-40 overflow-auto">
                    {combinedStats.forecast.slice(0,12).map((f,i)=>(<li key={i} className="flex justify-between"><span>{new Date(f.time).toLocaleString()}</span><span className="font-medium">{f.value} {combinedStats.stats.unit}</span></li>))}
                  </ul>
                </div>
              </div>
            )}
          </section>

          <aside className="bg-white rounded-lg shadow p-6">
            <h3 className="font-semibold mb-2">Project controls</h3>
            <p className="text-sm text-slate-600">Upload training data, preview sheets, and run AI training or the synthetic forecast generator.</p>

            <div className="mt-6">
              <h4 className="font-medium">Forecast (next 48h)</h4>
              {forecast ? (
                <ul className="mt-2 text-sm text-slate-700 space-y-1">
                  {forecast.slice(0, 12).map((f, i) => (
                    <li key={i} className="flex justify-between"><span>{new Date(f.time).toLocaleString()}</span><span className="font-medium">{f.value} {UNIT}</span></li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 text-sm text-slate-500">No forecast yet</div>
              )}
            </div>

            {forecastStats && (
              <div className="mt-6 border-t pt-4">
                <h4 className="font-medium">Interpretation</h4>
                <div className="text-sm mt-2">
                  <div>Average (48h): <strong>{forecastStats.avg} {UNIT}</strong></div>
                  <div>Min: <strong>{forecastStats.min} {UNIT}</strong>  Max: <strong>{forecastStats.max} {UNIT}</strong></div>
                  <div className="mt-2">Peak expected around: <strong>{new Date(forecastStats.peakTime).toLocaleString()}</strong></div>
                </div>

                <div className="mt-3 text-sm">
                  <div className="font-medium">Driver breakdown (approx)</div>
                  <ul className="mt-1">
                    <li>Temperature effect: <em>colder temps increase heating load</em></li>
                    <li>EV uptake effect: <em>assumed {ev}% EV penetration increases evening load</em></li>
                    <li>Daily pattern: <em>morning/evening peaks from routine activity</em></li>
                  </ul>
                </div>

                {null}
              </div>
            )}

            <div className="mt-6 border-t pt-4">
              <h4 className="font-medium">Detected location</h4>
              <div className="text-sm text-slate-600">{countryInfo ? countryInfo.display_name : 'Unknown'}</div>
              {evSource && (
                <div className="mt-3 text-sm">
                  <div className="font-medium">Suggested EV data source</div>
                  <div><a className="text-nordic-600" href={evSource.source.url} target="_blank" rel="noreferrer">{evSource.source.name}</a></div>
                  <div className="text-xs text-slate-500">{evSource.source.note}</div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>

      <Footer />
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-2 rounded shadow transform transition-all duration-400 ease-out ${toast.closing ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'} ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`} role="status">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{toast.text}</span>
            <button className="text-xs opacity-80 hover:opacity-100" onClick={() => { setToast(t => t ? { ...t, closing: true } : null); setTimeout(()=>setToast(null), 300) }}>×</button>
          </div>
        </div>
      )}
    </div>
    </AppContext.Provider>
  )
}

// Helper components for hyper result card
function Stat({ label, value }) {
  return (
    <div className="bg-slate-50 rounded p-2 flex flex-col">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-semibold mt-1 truncate" title={String(value)}>{value}</div>
    </div>
  )
}
function DerivedStats({ trainingResult, unit }) {
  if (!trainingResult || !trainingResult.hourly_forecast_groups) return null
  const groups = Object.keys(trainingResult.hourly_forecast_groups)
  if (!groups.length) return null
  // Compute overall average of first group's 48h for quick summary
  const first = trainingResult.hourly_forecast_groups[groups[0]] || []
  const vals = first.map(r=>typeof r.value==='number'?r.value:0)
  const avg = vals.length? (vals.reduce((a,b)=>a+b,0)/vals.length):0
  const min = vals.length? Math.min(...vals):0
  const max = vals.length? Math.max(...vals):0
  // Attempt peak hour detection from first group
  let peakHour = null
  if (first.length) {
    const maxVal = Math.max(...vals)
    const peakIdx = vals.indexOf(maxVal)
    const dt = new Date(first[peakIdx].time)
    if (!Number.isNaN(dt.getTime())) peakHour = dt.getUTCHours()
  }
  return (
    <div className="mt-3 text-xs">
      <div className="font-medium mb-1">Derived metrics (first group)</div>
      <div className="flex flex-wrap gap-3">
        <div>Avg: <span className="font-semibold">{avg.toFixed(2)} {unit}</span></div>
        <div>Min: <span className="font-semibold">{min.toFixed(2)} {unit}</span></div>
        <div>Max: <span className="font-semibold">{max.toFixed(2)} {unit}</span></div>
        {peakHour!=null && <div>Peak hour: <span className="font-semibold">{peakHour}:00 UTC</span></div>}
      </div>
    </div>
  )
}
