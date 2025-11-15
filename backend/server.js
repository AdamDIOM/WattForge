require('dotenv').config()
const express = require('express')
const cors = require('cors')
const multer = require('multer')
const xlsx = require('xlsx')
const fs = require('fs')

const app = express()
app.use(cors())
app.use(express.json())
// multer setup for file uploads (disk storage)
const UPLOAD_DIR = process.env.UPLOAD_DIR || (process.cwd() + '/uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR)
  },
  filename: function (req, file, cb) {
    const safe = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
    cb(null, safe)
  }
})
const upload = multer({ storage })

// persisted upload metadata (simple JSON index)
const UPLOAD_INDEX_PATH = process.env.UPLOAD_INDEX_PATH || (UPLOAD_DIR + '/index.json')
let UPLOADS = []
try {
  if (fs.existsSync(UPLOAD_INDEX_PATH)) UPLOADS = JSON.parse(fs.readFileSync(UPLOAD_INDEX_PATH, 'utf8'))
} catch (e) { console.error('Failed to read upload index', e) }

function saveUploadIndex() {
  try { fs.writeFileSync(UPLOAD_INDEX_PATH, JSON.stringify(UPLOADS, null, 2)) } catch (e) { console.error('Failed to save upload index', e) }
}

// In-memory store for uploaded training data (simple demo)
const TRAINING_STORE = { prices: null, consumption: null, groups: null }
let LOADED_FILENAME = null

// Formatting helper for CSV numeric values: 3 decimals, comma as decimal separator
function fmtFWh(n) {
  const s = Number(n).toFixed(3)
  return s.replace('.', ',')
}

// Common helper: compute aggregate metrics from TRAINING_STORE.consumption
function computeConsumptionAggregates() {
  if (!TRAINING_STORE.consumption) return null
  const consum = TRAINING_STORE.consumption
  let avg = 0, min = Infinity, max = -Infinity, count = 0
  const hourlySum = Array(24).fill(0)
  const hourlyCount = Array(24).fill(0)
  for (const row of consum) {
    const vals = Object.entries(row).slice(1).map(([k,v]) => Number(v) || 0)
    const total = vals.reduce((a,b)=>a+b,0)
    avg += total; count++
    if (total < min) min = total
    if (total > max) max = total
    const t = row.measured_at || row.measuredAt || Object.values(row)[0]
    const dt = new Date(t)
    if (!Number.isNaN(dt.getTime())) {
      const h = dt.getHours()
      hourlySum[h] += total
      hourlyCount[h] += 1
    }
  }
  avg = count ? (avg / count) : 0
  const hourlyAvg = hourlySum.map((s,i)=> hourlyCount[i] ? s / hourlyCount[i] : 0)
  const peakHour = hourlyAvg.indexOf(Math.max(...hourlyAvg))
  return { avg, min, max, count, peakHour, hourlyAvg }
}

// Helper: extract all group column keys (excluding timestamp) from first consumption row
function extractGroupKeys(max = 150) {
  if (!TRAINING_STORE.consumption || TRAINING_STORE.consumption.length === 0) return []
  const sample = TRAINING_STORE.consumption[0]
  const keys = Object.keys(sample)
  // detect timestamp key
  const tsKey = keys.find(k => /measured|time|timestamp/i.test(k)) || keys[0]
  const groupKeys = keys.filter(k => k !== tsKey)
  // cap for safety
  return groupKeys.slice(0, max)
}

// Helper: parse optional start timestamp from query (ISO or epoch). Returns ms number.
function parseStartMs(req) {
  const s = (req.query && req.query.start) ? String(req.query.start) : null
  if (!s) return Date.now()
  const n = Number(s)
  if (!Number.isNaN(n) && n > 0) return n
  const d = new Date(s)
  const ms = d.getTime()
  return Number.isNaN(ms) ? Date.now() : ms
}

function firstOfMonthUtcFrom(ms) {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0)
}

function hoursInMonthUtc(year, monthIndex /* 0-11 */) {
  // last day of month at UTC, date=0 of next month gives last day of current
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return days * 24
}

// Helper to load a saved upload file into TRAINING_STORE (used on upload handling and at startup)
function loadUploadIntoMemory(meta) {
  try {
    if (!meta || !meta.path || !fs.existsSync(meta.path)) return false
    const wb = xlsx.readFile(meta.path)
    const sheetNames = wb.SheetNames.map(n => n.toLowerCase())
    function readSheet(name) {
      const idx = sheetNames.indexOf(name.toLowerCase())
      if (idx === -1) return null
      const ws = wb.Sheets[wb.SheetNames[idx]]
      const json = xlsx.utils.sheet_to_json(ws, { defval: null })
      return json
    }
    const prices = readSheet('training_prices')
    const consumption = readSheet('training_consumption')
    const groups = readSheet('groups')
    if (!prices || !consumption || !groups) return false
    TRAINING_STORE.prices = prices
    TRAINING_STORE.consumption = consumption
    TRAINING_STORE.groups = groups
  LOADED_FILENAME = meta.filename
  console.log('Loaded training workbook into memory from', meta.filename)
    return true
  } catch (e) {
    console.error('Failed to load upload into memory', e)
    return false
  }
}

// POST /api/upload-training - accept an Excel file and parse sheets
app.post('/api/upload-training', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (form field "file")' })
    // parse workbook from saved file path
    const fullpath = req.file.path
    const wb = xlsx.readFile(fullpath)
    const sheetNames = wb.SheetNames.map(n => n.toLowerCase())

    function readSheet(name) {
      const idx = sheetNames.indexOf(name.toLowerCase())
      if (idx === -1) return null
      const ws = wb.Sheets[wb.SheetNames[idx]]
      const json = xlsx.utils.sheet_to_json(ws, { defval: null })
      return json
    }

    const prices = readSheet('training_prices')
    const consumption = readSheet('training_consumption')
    const groups = readSheet('groups')

    // Basic validation and warnings
    const warnings = []
    if (!prices) warnings.push('Missing sheet: training_prices')
    if (!consumption) warnings.push('Missing sheet: training_consumption')
    if (!groups) warnings.push('Missing sheet: groups')
    if (warnings.length) return res.status(400).json({ error: 'Invalid workbook', warnings })

    // persist parsed training into memory and record upload
    const meta = { filename: req.file.filename, originalname: req.file.originalname, path: fullpath, uploadedAt: new Date().toISOString(), summary: { prices_rows: prices.length, consumption_rows: consumption.length, groups_rows: groups.length } }
  UPLOADS.unshift(meta)
  saveUploadIndex()
  console.log('Saved upload metadata:', meta.filename)

    TRAINING_STORE.prices = prices
    TRAINING_STORE.consumption = consumption
    TRAINING_STORE.groups = groups
    LOADED_FILENAME = req.file ? req.file.filename : LOADED_FILENAME
  console.log('TRAINING_STORE populated: prices=%d consumption=%d groups=%d', prices.length, consumption.length, groups.length)

    res.json({ ok: true, summary: meta.summary, file: meta })
  } catch (err) {
    console.error('upload-training error', err)
    res.status(500).json({ error: 'Failed to parse workbook' })
  }
})

// List uploaded workbooks
app.get('/api/uploads', (req, res) => {
  res.json({ uploads: UPLOADS })
})

// Load an existing upload into the in-memory TRAINING_STORE.
// Query: ?name=<filename> (as returned by /api/uploads)
app.get('/api/load-upload', (req, res) => {
  try {
    const name = req.query.name
    if (!name) return res.status(400).json({ error: 'name query required' })
    const meta = UPLOADS.find(u => u.filename === name)
    if (!meta) return res.status(404).json({ error: 'Upload not found' })
    const ok = loadUploadIntoMemory(meta)
    if (!ok) return res.status(500).json({ error: 'Failed to load upload into memory (check file integrity)' })
    return res.json({ ok: true, loaded: meta.filename })
  } catch (e) {
    console.error('load-upload error', e)
    res.status(500).json({ error: 'Failed to load upload' })
  }
})

// Preview a sheet of a previously uploaded workbook
app.get('/api/upload-preview', (req, res) => {
  try {
    const name = req.query.name
    const sheet = req.query.sheet || 'training_consumption'
    const rows = parseInt(req.query.rows || '5', 10)
    if (!name) return res.status(400).json({ error: 'name query required (filename returned by /api/uploads)' })
    const meta = UPLOADS.find(u => u.filename === name)
    if (!meta) return res.status(404).json({ error: 'Upload not found' })
    const wb = xlsx.readFile(meta.path)
    const sheetNames = wb.SheetNames.map(n => n.toLowerCase())
    const idx = sheetNames.indexOf(sheet.toLowerCase())
    if (idx === -1) return res.status(404).json({ error: 'Sheet not found in workbook' })
    const ws = wb.Sheets[wb.SheetNames[idx]]
    const json = xlsx.utils.sheet_to_json(ws, { defval: null })
    res.json({ preview: json.slice(0, rows) })
  } catch (err) {
    console.error('upload-preview error', err)
    res.status(500).json({ error: 'Preview failed' })
  }
})

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from backend!' })
})

// Check whether training data is loaded into memory and return basic summary
app.get('/api/check-training', (req, res) => {
  try {
    const loaded = !!(TRAINING_STORE.prices && TRAINING_STORE.consumption && TRAINING_STORE.groups)
    const summary = loaded ? { prices_rows: TRAINING_STORE.prices.length, consumption_rows: TRAINING_STORE.consumption.length, groups_rows: TRAINING_STORE.groups.length } : null
  res.json({ loaded, summary, filename: LOADED_FILENAME })
  } catch (e) { console.error('check-training error', e); res.status(500).json({ error: 'Failed' }) }
})

// Run a quick sanity mock generation using current TRAINING_STORE (same logic as /api/train-ai)
app.get('/api/sanity-check', (req, res) => {
  try {
    if (!TRAINING_STORE.consumption) return res.status(400).json({ error: 'No training consumption data loaded' })
    const sample = TRAINING_STORE.consumption.slice(0, 6)
    const generated = sample.map((row, idx) => {
      const time = row.measured_at || row.measuredAt || Object.values(row)[0]
      const vals = Object.entries(row).slice(1).map(([k,v]) => Number(v) || 0)
      const base = Math.max(0, vals.reduce((a,b)=>a+b,0))
      return { time, value: Math.round(base * 100) / 100 }
    })
    res.json({ ok: true, sample: generated })
  } catch (e) { console.error('sanity-check error', e); res.status(500).json({ error: 'Failed' }) }
})

// Produce two CSV prediction objects: hourly next 48h and monthly next 12 months.
// Returns JSON with keys hourly_csv and monthly_csv (semicolon-delimited).
app.get('/api/predict-csv', (req, res) => {
  try {
  // Wide group columns from training (exclude timestamp) or fallback baseline set
  let groupKeys = extractGroupKeys(160)
  if (groupKeys.length === 0) groupKeys = ['28','29','30','36','37','38','39','40','41','42','43']

    // Build hourly 48h forecast with simple synthetic values.
    const startMs = parseStartMs(req)
    const hourlyRows = []
  for (let h=0; h<48; h++) {
      const at = new Date(startMs + h*3600000)
      const t = at.toISOString()
      const vals = groupKeys.map((g,i) => {
        // per-hour synthetic load ~0..5 with diurnal pattern and tiny group offsets
        const hourOfDay = at.getUTCHours()
        const diurnal = Math.sin((hourOfDay/24)*Math.PI*2)
        const perHour = Math.max(0, 2.0 + 1.0*diurnal + 0.02*i + (h%3)*0.05)
  return fmtFWh(perHour)
      })
      hourlyRows.push([t, ...vals])
    }

    // Build monthly 12 month forecast.
    const monthlyRows = []
    const month0 = firstOfMonthUtcFrom(startMs)
    for (let m=0; m<12; m++) {
      const d = new Date(Date.UTC(new Date(month0).getUTCFullYear(), new Date(month0).getUTCMonth()+m, 1, 0, 0, 0))
      const iso = d.toISOString()
      const hInMonth = hoursInMonthUtc(d.getUTCFullYear(), d.getUTCMonth())
  const vals = groupKeys.map((g,i) => {
        // per-hour seasonal base around 2.0, then scale by hours in month
        const monthIndex = d.getUTCMonth()
        const perHour = Math.max(0, 2.0 + 0.3*Math.cos((monthIndex/12)*Math.PI*2) + 0.02*i)
    return fmtFWh(perHour * hInMonth)
      })
      monthlyRows.push([iso, ...vals])
    }

  const header = ['measured_at', ...groupKeys].join(';')
    const hourly_csv = [header, ...hourlyRows.map(r => r.join(';'))].join('\n')
  const monthly_csv = [header, ...monthlyRows.map(r => r.join(';'))].join('\n')
    res.json({ hourly_csv, monthly_csv })
  } catch (e) {
    console.error('predict-csv error', e)
    res.status(500).json({ error: 'Failed to build prediction CSVs' })
  }
})

// Direct hourly CSV endpoint
app.get('/api/predict-hourly.csv', (req, res) => {
  try {
  let groupKeys = extractGroupKeys(160)
  if (groupKeys.length === 0) groupKeys = ['28','29','30','36','37','38','39','40','41','42','43']
    const startMs = parseStartMs(req)
    const rows = []
  for (let h=0; h<48; h++) {
      const at = new Date(startMs + h*3600000)
      const t = at.toISOString()
      const vals = groupKeys.map((g,i)=>{
        const hour = at.getUTCHours()
        const diurnal = Math.sin((hour/24)*Math.PI*2)
        const perHour = Math.max(0, 2.0 + 1.0*diurnal + 0.02*i + (h%3)*0.05)
    return fmtFWh(perHour)
      })
      rows.push([t, ...vals])
    }
  const header = ['measured_at', ...groupKeys].join(';')
    const csv = [header, ...rows.map(r=>r.join(';'))].join('\n')
    res.setHeader('Content-Type','text/csv')
    res.send(csv)
  } catch (e) { console.error('predict-hourly.csv error', e); res.status(500).send('error') }
})

// Direct monthly CSV endpoint
app.get('/api/predict-monthly.csv', (req, res) => {
  try {
  let groupKeys = extractGroupKeys(160)
  if (groupKeys.length === 0) groupKeys = ['28','29','30','36','37','38','39','40','41','42','43']
    const startMs = parseStartMs(req)
    const rows = []
    const month0 = firstOfMonthUtcFrom(startMs)
    for (let m=0; m<12; m++) {
      const d = new Date(Date.UTC(new Date(month0).getUTCFullYear(), new Date(month0).getUTCMonth()+m, 1, 0, 0, 0))
      const iso = d.toISOString()
      const hInMonth = hoursInMonthUtc(d.getUTCFullYear(), d.getUTCMonth())
      const vals = groupKeys.map((g,i)=>{
        const monthIndex = d.getUTCMonth()
        const perHour = Math.max(0, 2.0 + 0.3*Math.cos((monthIndex/12)*Math.PI*2) + 0.02*i)
        return fmtFWh(perHour * hInMonth)
      })
      rows.push([iso, ...vals])
    }
    const header = ['measured_at', ...groupKeys].join(';')
    const csv = [header, ...rows.map(r=>r.join(';'))].join('\n')
    res.setHeader('Content-Type','text/csv')
    res.send(csv)
  } catch (e) { console.error('predict-monthly.csv error', e); res.status(500).send('error') }
})

// Proxy weather data (uses Open-Meteo, no API key required)
app.get('/api/weather', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat)
    const lon = parseFloat(req.query.lon)
    const days = parseInt(req.query.days || '2', 10)
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      return res.status(400).json({ error: 'lat and lon query params required' })
    }

    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      hourly: 'temperature_2m',
      daily: 'sunrise,sunset',
      timezone: 'auto',
      past_days: '0'
    })

    const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`
    const r = await fetch(url)
    if (!r.ok) throw new Error('weather fetch failed')
    const data = await r.json()
    res.json({ source: 'open-meteo', data })
  } catch (err) {
    console.error('weather error', err)
    res.status(500).json({ error: 'Failed to fetch weather' })
  }
})

// Simple synthetic forecast endpoint — lightweight placeholder for demo.
// Accepts lat, lon, ev (EV uptake percent 0-100) and hours (how many hours ahead)
app.get('/api/forecast', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat)
    const lon = parseFloat(req.query.lon)
    const ev = parseFloat(req.query.ev || '0') // percent
    const hours = parseInt(req.query.hours || '48', 10)
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      return res.status(400).json({ error: 'lat and lon query params required' })
    }

    // Fetch current hourly temperatures to base the forecast on
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      hourly: 'temperature_2m',
      timezone: 'auto',
      past_days: '0'
    })
    const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`
    const r = await fetch(url)
    const weather = await r.json()

    // Build synthetic forecast: base consumption pattern + temp and EV effects
    const now = Date.now()
    const hourMs = 1000 * 60 * 60
    const forecast = []
    for (let h = 0; h < hours; h++) {
      const t = new Date(now + h * hourMs)
      const hourOfDay = t.getUTCHours()
      // base daily curve in FWh: center ~2.0 with +/-1.0 swings
      const diurnal = Math.sin((hourOfDay / 24) * Math.PI * 2)
      // estimate temperature if available
      let temp = null
      if (weather && weather.hourly && Array.isArray(weather.hourly.temperature_2m)) {
        temp = weather.hourly.temperature_2m[h % weather.hourly.temperature_2m.length]
      }
      // small temperature effect in FWh
      const tempEffect = temp === null ? 0 : Math.max(0, 15 - temp) * 0.03
      // EV effect: tiny nighttime bump scaled to FWh
      const evActiveFactor = (hourOfDay >= 18 || hourOfDay <= 7) ? 1.0 : 0.3
      const evEffect = (ev / 100) * 0.08 * evActiveFactor
      const perHour = Math.max(0, 2.0 + 1.0 * diurnal + tempEffect + evEffect)
      const predicted = Math.round(perHour * 1000) / 1000
      forecast.push({ time: t.toISOString(), value: predicted })
    }

    res.json({ forecast, metadata: { lat, lon, ev } })
  } catch (err) {
    console.error('forecast error', err)
    res.status(500).json({ error: 'Failed to compute forecast' })
  }
})

// Combined stats endpoint: merges training aggregates, current weather, EV uptake and produces recommendations and a synthetic forecast
// GET /api/combined-stats?lat=..&lon=..&ev=..
app.get('/api/combined-stats', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat)
    const lon = parseFloat(req.query.lon)
    const ev = parseFloat(req.query.ev || '0')
    if (Number.isNaN(lat) || Number.isNaN(lon)) return res.status(400).json({ error: 'lat/lon required' })
    if (!TRAINING_STORE.consumption || !TRAINING_STORE.prices || !TRAINING_STORE.groups) {
      return res.status(400).json({ error: 'No training data loaded' })
    }

    // Weather fetch (hourly temperature next 48h)
    let temps = []
    try {
      const params = new URLSearchParams({ latitude: String(lat), longitude: String(lon), hourly: 'temperature_2m', timezone: 'UTC', past_days: '0' })
      const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`
      const r = await fetch(url)
      if (r.ok) {
        const w = await r.json()
        temps = (w.hourly && w.hourly.temperature_2m) ? w.hourly.temperature_2m.slice(0,48) : []
      }
    } catch (e) { /* ignore weather errors */ }

    const aggs = computeConsumptionAggregates()
    if (!aggs) return res.status(500).json({ error: 'Failed aggregates' })

    // Heating factor: average (15 - temp) positive portion
    const heatingFactor = temps.length ? temps.map(t => Math.max(0, 15 - t)).reduce((a,b)=>a+b,0) / temps.length : 0
    // EV nightly load estimate: scale by EV% and count of night hours in next 48h
    const nightHours = temps.length ? temps.filter((_,i)=>{ const h = (new Date(Date.now()+i*3600000)).getUTCHours(); return (h >= 18 || h <= 7) }).length : 0
    const evNightLoad = (ev/100) * nightHours * 20 // arbitrary scaling

    // Build synthetic forward 48h aggregated forecast in FWh (~0..5 per hour)
    const now = Date.now()
    const hourMs = 3600000
    const forward = []
    for (let h=0; h<48; h++) {
      const t = new Date(now + h*hourMs)
      const hourOfDay = t.getUTCHours()
      const diurnal = Math.sin((hourOfDay/24)*Math.PI*2)
      const temp = temps[h] !== undefined ? temps[h] : null
      const tempEffect = temp === null ? 0 : Math.max(0, 15 - temp) * 0.03
      const evActiveFactor = (hourOfDay >= 18 || hourOfDay <= 7) ? 1.0 : 0.3
      const evEffect = (ev / 100) * 0.08 * evActiveFactor
      const perHour = Math.max(0, 2.0 + 1.0*diurnal + tempEffect + evEffect)
      const predicted = Math.round(perHour * 1000) / 1000
      forward.push({ time: t.toISOString(), value: predicted })
    }

    // Recommendations heuristic
    const recommendations = []
    if (heatingFactor > 3) recommendations.push('Consider pre-heating during midday to reduce evening peak.')
    if (evNightLoad > 200) recommendations.push('Implement smart charging to spread EV load across more off-peak hours.')
    if (aggs.peakHour >= 17 && aggs.peakHour <= 21) recommendations.push('Shift discretionary consumption away from early evening peak (17-21h).')
    if (recommendations.length === 0) recommendations.push('Operational profile appears balanced; monitor for anomalies.')

  const UNIT = 'FWh'
    res.json({
      ok: true,
      stats: {
        training_avg: Math.round(aggs.avg*100)/100,
        training_min: Math.round(aggs.min*100)/100,
        training_max: Math.round(aggs.max*100)/100,
        peak_hour_training: aggs.peakHour,
        heating_factor: Math.round(heatingFactor*100)/100,
        ev_night_load_index: Math.round(evNightLoad*100)/100,
        unit: UNIT
      },
      drivers: ['Historical load shape', 'Temperature (heating)', 'EV penetration'],
      recommendations,
      forecast: forward,
      weather_sample: temps.slice(0,12),
      training_loaded: LOADED_FILENAME
    })
  } catch (e) {
    console.error('combined-stats error', e)
    res.status(500).json({ error: 'Failed to build combined stats' })
  }
})

// Simple EV uptake estimator endpoint.
// mode=heuristic (default) - returns a synthetic % based on latitude/longitude
// mode=ai - reserved for future AI-backed estimates (not implemented)
app.get('/api/ev', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat)
    const lon = parseFloat(req.query.lon)
    const mode = req.query.mode || 'heuristic'
    if (Number.isNaN(lat) || Number.isNaN(lon)) return res.status(400).json({ error: 'lat/lon required' })

    if (mode === 'ai') {
      // Placeholder: implementing a real AI query (Gemini or similar) requires credentials and external calls.
      return res.status(501).json({ error: 'AI mode not implemented in this demo' })
    }

    // Heuristic: more urban lat/lon -> higher EV uptake. Use latitude as rough proxy (south=more urban in Finland)
    // and proximity to Helsinki increases uptake. This is illustrative only.
    const helsinki = { lat: 60.1699, lon: 24.9384 }
    const dlat = Math.abs(lat - helsinki.lat)
    const dlon = Math.abs(lon - helsinki.lon)
    const distScore = Math.max(0, 1 - (Math.sqrt(dlat * dlat + dlon * dlon) / 5)) // rough
    let base = 10 + distScore * 50 // base 10-60%

    // small random-ish adjustment using fractional part of coords
    const jitter = (Math.abs(lat * lon) % 1) * 5
    const ev = Math.round(Math.min(95, Math.max(1, base + jitter)))
    res.json({ ev })
  } catch (err) {
    console.error('ev error', err)
    res.status(500).json({ error: 'Failed to estimate EV uptake' })
  }
})

// Reverse geocode to get country information using Nominatim
app.get('/api/reverse', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat)
    const lon = parseFloat(req.query.lon)
    if (Number.isNaN(lat) || Number.isNaN(lon)) return res.status(400).json({ error: 'lat/lon required' })

    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`
    const r = await fetch(url, { headers: { 'User-Agent': 'junction-hack-demo/1.0' } })
    if (!r.ok) throw new Error('reverse geocode failed')
    const data = await r.json()
    const country = data.address && (data.address.country || data.address.country_code)
    const country_code = data.address && data.address.country_code
    res.json({ country: data.address ? data.address.country : null, country_code: country_code ? country_code.toUpperCase() : null, display_name: data.display_name, raw: data })
  } catch (err) {
    console.error('reverse error', err)
    res.status(500).json({ error: 'Failed to reverse geocode' })
  }
})

// Map country codes to suggested EV data sources (examples/suggestions).
const EV_SOURCES = {
  FI: { name: 'Statistics Finland', url: 'https://www.stat.fi', note: 'Official statistics portal — may provide vehicle registrations and transport stats.' },
  SE: { name: 'Statistics Sweden', url: 'https://www.scb.se', note: 'National statistics authority.' },
  NO: { name: 'Statistics Norway', url: 'https://www.ssb.no', note: 'National statistics agency.' },
  DE: { name: 'Destatis / KBA', url: 'https://www.destatis.de', note: 'National statistics; vehicle registration often with KBA.' },
  UK: { name: 'UK Government / DVLA', url: 'https://www.gov.uk', note: 'DVLA and government publications may include EV registrations.' },
  default: { name: 'ACEA / EU datasets', url: 'https://www.acea.auto', note: 'European-level vehicle statistics and national portals.' }
}

app.get('/api/evsource', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat)
    const lon = parseFloat(req.query.lon)
    if (Number.isNaN(lat) || Number.isNaN(lon)) return res.status(400).json({ error: 'lat/lon required' })

    // reverse geocode
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`
    const r = await fetch(url, { headers: { 'User-Agent': 'junction-hack-demo/1.0' } })
    const data = await r.json()
    const country_code = data.address && data.address.country_code ? data.address.country_code.toUpperCase() : null
    const source = (country_code && EV_SOURCES[country_code]) ? EV_SOURCES[country_code] : EV_SOURCES.default
    res.json({ country: data.address ? data.address.country : null, country_code, source })
  } catch (err) {
    console.error('evsource error', err)
    res.status(500).json({ error: 'Failed to determine EV data source' })
  }
})

// Mock AI analysis endpoint — in production you'd call a real LLM (Gemini/OpenAI)
app.post('/api/ai', express.json(), (req, res) => {
  try {
    const prompt = req.body.prompt || ''
    const forecast = req.body.forecast || []

    // Simple heuristic summary
    const values = forecast.map(f => f.value)
    const max = Math.max(...values)
    const min = Math.min(...values)
    const avg = Math.round(values.reduce((a,b)=>a+b,0)/Math.max(1,values.length))

    const summary = `Mock analysis: forecast avg=${avg}, min=${min}, max=${max}. Drivers: temperature and EV uptake.`
    res.json({ summary })
  } catch (err) {
    console.error('ai error', err)
    res.status(500).json({ error: 'AI analysis failed' })
  }
})

// Mock training endpoint: consume uploaded training data and forecast, return generated example series
app.post('/api/train-ai', express.json(), (req, res) => {
  try {
    // Expect client to have uploaded training workbook earlier
    if (!TRAINING_STORE.consumption || !TRAINING_STORE.prices || !TRAINING_STORE.groups) {
      return res.status(400).json({ error: 'No training data uploaded. Call /api/upload-training first.' })
    }

    // Basic behaviour: use historical hourly consumption from the first few rows to seed a pattern
    // and combine with incoming forecast (optional) to produce a synthetic "generated" forecast.
    const forecast = req.body.forecast || []

    // pick first timestamp series from consumption sheet (assumes column "measured_at")
    const consum = TRAINING_STORE.consumption
    const prices = TRAINING_STORE.prices

    // simple aggregation: take mean across groups for each timestamp (if data is wide)
    // if consumption rows have many numeric columns, compute their row-sum as proxy
    const sample = consum.slice(0, 48)
    const generated = sample.map((row, idx) => {
      const time = row.measured_at || row.measuredAt || Object.values(row)[0]
      // sum numeric columns excluding the first (timestamp)
      const vals = Object.entries(row).slice(1).map(([k,v]) => Number(v) || 0)
      const base = Math.max(0, vals.reduce((a,b)=>a+b,0))
      // optionally blend with forecast value
      const blend = (forecast[idx] && forecast[idx].value) ? (forecast[idx].value * 0.6 + base * 0.4) : base
      return { time, value: Math.round(blend * 100) / 100 }
    })

    res.json({ result: 'mock-generated', generated })
  } catch (err) {
    console.error('train-ai error', err)
    res.status(500).json({ error: 'Training failed' })
  }
})

// Train via LLM: send training data + forecast to an LLM to generate synthetic output
app.post('/api/train-ai-llm', express.json(), async (req, res) => {
  try {
    if (!TRAINING_STORE.consumption || !TRAINING_STORE.prices || !TRAINING_STORE.groups) {
      return res.status(400).json({ error: 'No training data uploaded. Call /api/upload-training first.' })
    }
    const forecast = req.body.forecast || []

    // If OPENAI_API_KEY present, forward a short prompt; otherwise return mock
    const key = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY
    if (!key) {
      // No LLM key configured — return the same mock behaviour as /api/train-ai
      const consum = TRAINING_STORE.consumption
      const sample = consum.slice(0, 48)
      const generated = sample.map((row, idx) => {
        const time = row.measured_at || row.measuredAt || Object.values(row)[0]
        const vals = Object.entries(row).slice(1).map(([k,v]) => Number(v) || 0)
        const base = Math.max(0, vals.reduce((a,b)=>a+b,0))
        const blend = (forecast[idx] && forecast[idx].value) ? (forecast[idx].value * 0.6 + base * 0.4) : base
        return { time, value: Math.round(blend * 100) / 100 }
      })
      return res.json({ result: 'mock-generated', generated })
    }

    // Build a compact prompt with small samples (avoid huge payloads)
    const sampleCons = TRAINING_STORE.consumption.slice(0, 48)
    const samplePrices = TRAINING_STORE.prices.slice(0, 48)
    const prompt = `You are given historical hourly consumption (JSON rows) and price series (JSON rows). Generate a synthetic 48-hour consumption forecast that is plausible and returns JSON array of {time,value}.
Consumption sample: ${JSON.stringify(sampleCons.slice(0,6))}
Price sample: ${JSON.stringify(samplePrices.slice(0,6))}
Forecast base (optional): ${JSON.stringify(forecast.slice(0,6))}
Return only JSON array.`

    // Prefer Gemini-style provider if configured. The backend will call GEMINI_API_URL (a full endpoint)
    // with Authorization: Bearer GEMINI_API_KEY. This keeps the client flexible: set GEMINI_API_URL to
    // your provider endpoint (for example a Google Generative API endpoint) and provide the key.
    const geminiKey = process.env.GEMINI_API_KEY
    const geminiUrl = process.env.GEMINI_API_URL
    if (geminiKey && geminiUrl) {
      const resp = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${geminiKey}` },
        body: JSON.stringify({ prompt })
      })
      if (!resp.ok) {
        const txt = await resp.text()
        console.error('gemini error', txt)
        return res.status(502).json({ error: 'LLM (Gemini) call failed', details: txt })
      }
      const body = await resp.text()
      // Try to parse JSON directly; if the model returned text containing JSON, extract it
      let parsed = null
      try { parsed = JSON.parse(body) } catch (e) {
        const m = body && body.match(/\[\s*\{[\s\S]*\}\s*\]/)
        if (m) try { parsed = JSON.parse(m[0]) } catch (e2) { parsed = null }
      }
      if (!parsed) return res.status(502).json({ error: 'LLM did not return JSON', raw: body })
      return res.json({ result: 'llm-generated', generated: parsed })
    }

    // If not configured for Gemini, fall back to mock behaviour (already handled earlier but keep here as safety)
    const consum = TRAINING_STORE.consumption
    const sample = consum.slice(0, 48)
    const generated = sample.map((row, idx) => {
      const time = row.measured_at || row.measuredAt || Object.values(row)[0]
      const vals = Object.entries(row).slice(1).map(([k,v]) => Number(v) || 0)
      const base = Math.max(0, vals.reduce((a,b)=>a+b,0))
      const blend = (forecast[idx] && forecast[idx].value) ? (forecast[idx].value * 0.6 + base * 0.4) : base
      return { time, value: Math.round(blend * 100) / 100 }
    })
    return res.json({ result: 'mock-generated', generated })
  } catch (err) {
    console.error('train-ai-llm error', err)
    res.status(500).json({ error: 'LLM training failed' })
  }
})

// Hyper train endpoint: combines training data, optional existing forecast, and live weather + EV context.
// POST /api/hyper-train { lat, lon, ev, forecast? }
// Returns generated 48h series and lightweight analysis. Uses Gemini if configured, else local synthesis.
app.post('/api/hyper-train', express.json(), async (req, res) => {
  try {
    if (!TRAINING_STORE.consumption || !TRAINING_STORE.prices || !TRAINING_STORE.groups) {
      return res.status(400).json({ error: 'No training data uploaded. Upload first.' })
    }
    const { lat, lon, ev = 0, forecast: incomingForecast = [] } = req.body || {}
    // If no forecast supplied, build a quick synthetic forecast using same logic as /api/forecast (48h)
    let baseForecast = incomingForecast
    if (!Array.isArray(baseForecast) || baseForecast.length === 0) {
      if (lat !== undefined && lon !== undefined) {
        try {
          const params = new URLSearchParams({ latitude: String(lat), longitude: String(lon), hourly: 'temperature_2m', timezone: 'auto', past_days: '0' })
          const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`
          const r = await fetch(url)
          const w = r.ok ? await r.json() : null
          const temps = w && w.hourly && w.hourly.temperature_2m ? w.hourly.temperature_2m : []
          const now = Date.now(), hourMs = 3600000
          baseForecast = []
          for (let h=0; h<48; h++) {
            const t = new Date(now + h*hourMs)
            const hourOfDay = t.getHours()
            const daily = 100 + 40 * Math.sin(((hourOfDay - 6)/24)*Math.PI*2)
            const temp = temps[h % temps.length] || null
            const tempEffect = temp === null ? 0 : Math.max(0, 15 - temp) * 1.8
            const evActive = (hourOfDay >= 18 || hourOfDay <= 7) ? 1.0 : 0.3
            const evEffect = (ev/100) * 20 * evActive
            baseForecast.push({ time: new Date(now + h*hourMs).toISOString(), value: Math.round(daily + tempEffect + evEffect) })
          }
        } catch (e) { baseForecast = [] }
      }
    }

    const aggs = computeConsumptionAggregates()
    // Construct local generated series by blending consumption sample with base forecast
    const consum = TRAINING_STORE.consumption
    const sample = consum.slice(0,48)
    const generatedLocal = sample.map((row, idx) => {
      const time = row.measured_at || row.measuredAt || Object.values(row)[0]
      const vals = Object.entries(row).slice(1).map(([k,v]) => Number(v) || 0)
      const base = Math.max(0, vals.reduce((a,b)=>a+b,0))
      const bf = (baseForecast[idx] && baseForecast[idx].value) ? baseForecast[idx].value : base
      const blend = bf * 0.6 + base * 0.4
      return { time: typeof time === 'string' ? time : new Date().toISOString(), value: Math.round(blend*100)/100 }
    })

    // LLM integration: if Gemini configured, ask for refined generation + drivers
    const geminiUrl = process.env.GEMINI_API_URL
    const accessToken = process.env.GEMINI_ACCESS_TOKEN
    const apiKey = process.env.GEMINI_API_KEY
    // Derive group keys from training consumption (exclude timestamp)
    let groupKeys = extractGroupKeys(160)
    if (groupKeys.length === 0) {
      // fallback synthetic labels
      groupKeys = ['28','29','30','36','37','38','39','40','41','42','43']
    }
    if (!geminiUrl) {
      return res.json({
        result: 'hyper-generated-mock',
        generated: generatedLocal,
        analysis: {
          summary: {
            training_avg: Math.round(aggs.avg*100)/100,
            training_peak_hour: aggs.peakHour,
            ev_percent: ev,
            blended_hours: generatedLocal.length
          },
          drivers: ['Historical load shape', 'Temperature (if weather fetched)', 'EV penetration'],
          notes: 'LLM not configured; using local synthetic blend.'
        }
      })
    }

    // Build compact prompt requesting per-group forecasts (48h hourly & 12-month monthly)
    const sampleCons = TRAINING_STORE.consumption.slice(0, 24)
    const samplePrices = TRAINING_STORE.prices.slice(0, 24)
    const prompt = `You are an energy forecasting assistant.
STRICT JSON CONTRACT: Return EXACTLY one JSON object (no markdown, no code fences, no commentary) with these top-level keys ONLY:
  "hourly_forecast_groups": { <groupKey>: [ {"time": "YYYY-MM-DDTHH:00:00Z", "value": number }, ... 48 items ], ... }
  "monthly_forecast_groups": { <groupKey>: [ {"month": "YYYY-MM-01T00:00:00Z", "value": number }, ... 12 items ], ... }
  "analysis": { "drivers": [string], "recommendations": [string], "summary": { "avg": number, "min": number, "max": number, "peakHour": integer } }
GROUP KEYS (TOTAL ${groupKeys.length} = MUST MATCH COUNT, DO NOT OMIT ANY): [${groupKeys.join(', ')}]
REQUIREMENTS:
  1. Provide 48 hourly entries for EVERY group key (consecutive UTC hours starting at current hour, aligned HH:00:00Z).
  2. Provide 12 monthly entries for EVERY group key (first day of each of the next 12 months at 00:00:00Z).
  3. Each hourly entry object MUST have only {"time","value"}. Each monthly entry object ONLY {"month","value"}. No extra properties.
  4. Values are energy in FWh. Use realistic baseline 0..5 unless historical hints suggest higher; never negative; avoid spikes >10 unless clearly seasonal.
  5. If uncertainty for a group, synthesize using diurnal shape (slight evening peak) and mild seasonality for months.
  6. DO NOT skip or drop any group. If data insufficient, still output synthesized arrays.
  7. NO extra top-level keys (reject: status, total, metadata, explanation, etc.).
  8. Do NOT wrap output in backticks or add leading/trailing text.
SCHEMA EXAMPLE (illustrative only, truncated values): {"hourly_forecast_groups":{"g1":[{"time":"2025-01-01T00:00:00Z","value":2.1}]},"monthly_forecast_groups":{"g1":[{"month":"2025-02-01T00:00:00Z","value":1500}]},"analysis":{"drivers":["temperature"],"recommendations":["shift evening loads"],"summary":{"avg":2.2,"min":1.1,"max":4.1,"peakHour":19}}}
CONTEXT (use for pattern inference, DO NOT fully echo):
  consumption_sample_first6: ${JSON.stringify(sampleCons.slice(0,6))}
  price_sample_first6: ${JSON.stringify(samplePrices.slice(0,6))}
  base_forecast_first6: ${JSON.stringify(baseForecast.slice(0,6))}
  ev_percent: ${ev}
  training_aggregates: { avg:${Math.round(aggs.avg*100)/100}, min:${Math.round(aggs.min*100)/100}, max:${Math.round(aggs.max*100)/100}, peakHour:${aggs.peakHour} }
OUTPUT NOW: Return ONLY the JSON object adhering to contract.`

    let body = null
    if (geminiUrl.includes('generateText')) {
      // Legacy style (PaLM / early Gemini) expects a simple JSON body with prompt
      body = { prompt, temperature: 0.1, maxOutputTokens: 900 }
    } else if (geminiUrl.includes('generateContent')) {
      // Official Gemini generateContent style: role + parts
      body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 900 } }
    } else {
      // Generic fallback (custom proxy endpoints etc.)
      body = { prompt }
    }

    const headers = { 'Content-Type': 'application/json' }
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
    else if (apiKey) headers['X-goog-api-key'] = apiKey

    const resp = await fetch(geminiUrl, { method: 'POST', headers, body: JSON.stringify(body) })
    const txt = await resp.text()
    if (!resp.ok) {
      return res.status(502).json({ error: 'Gemini call failed', details: txt })
    }
    let rawObj = null
    // Attempt direct JSON parse
    try { rawObj = JSON.parse(txt) } catch (e) { rawObj = null }
    let jsonPayloadText = null
    if (rawObj && rawObj.generated) {
      // Custom proxy may have already produced desired structure
      jsonPayloadText = JSON.stringify(rawObj)
    } else if (rawObj && rawObj.candidates && Array.isArray(rawObj.candidates)) {
      // Gemini generateContent response shape
      const candidateTexts = rawObj.candidates.flatMap(c => (c.content && Array.isArray(c.content.parts)) ? c.content.parts.map(p => p.text).filter(Boolean) : []).filter(Boolean)
      jsonPayloadText = candidateTexts.join('\n').trim()
    } else if (rawObj && rawObj.output_text) {
      // Legacy generateText style (output_text field)
      jsonPayloadText = String(rawObj.output_text).trim()
    } else if (rawObj && rawObj.results && Array.isArray(rawObj.results) && rawObj.results[0] && rawObj.results[0].output_text) {
      // Another legacy variant
      jsonPayloadText = String(rawObj.results[0].output_text).trim()
    } else {
      // Fallback: treat entire response text as source for JSON extraction
      jsonPayloadText = txt.trim()
    }
    // Extract JSON object containing keys generated & analysis
    let parsed = null
    if (jsonPayloadText) {
      // Look for first JSON object
      const match = jsonPayloadText.match(/\{[\s\S]*\}/)
      if (match) {
        try { parsed = JSON.parse(match[0]) } catch (e) { parsed = null }
      } else {
        // If the model returned an array directly
        const arrMatch = jsonPayloadText.match(/\[[\s\S]*\]/)
        if (arrMatch) {
          try { const arrParsed = JSON.parse(arrMatch[0]); parsed = { generated: arrParsed } } catch (e2) { /* ignore */ }
        }
      }
    }
    // Additional fallback parsing: remove markdown fences/backticks, attempt second pass
    if ((!parsed || !parsed.generated) && jsonPayloadText) {
      const cleaned = jsonPayloadText
        .replace(/```json/gi,'')
        .replace(/```/g,'')
        .replace(/\n/g,' ')
        .trim()
      // Try to isolate JSON object with generated key
      const objMatch = cleaned.match(/\{[^{]*"generated"[\s\S]*\}/)
      if (objMatch) {
        try { parsed = JSON.parse(objMatch[0]) } catch (e) { /* ignore */ }
      }
      // If still not parsed and we have an array that looks like generated series
      if ((!parsed || !parsed.generated)) {
        const arrOnly = cleaned.match(/\[[\s\S]*\]/)
        if (arrOnly) {
          try { const arrParsed = JSON.parse(arrOnly[0]); parsed = { generated: arrParsed, analysis: { drivers: [], recommendations: [], summary: { avg:0,min:0,max:0,peakHour:0 } } } } catch (e2) { /* ignore */ }
        }
      }
    }
    // Guardrail normalization helpers
    function clampNumber(v, {min=0, max=100000}={}) { const n=Number(v); return Number.isNaN(n)?min:Math.min(max,Math.max(min,n)) }
    function normalizeHourlyGroup(arr) {
      if (!Array.isArray(arr)) return []
      const out = []
      for (let i=0;i<Math.min(48, arr.length);i++) {
        const item = arr[i]
        const t = item && typeof item.time==='string' ? item.time : new Date(Date.now()+i*3600000).toISOString().replace(/:\d{2}\.\d{3}Z$/,':00:00Z')
        out.push({ time: t, value: clampNumber(item && item.value, {min:0, max:50}) })
      }
      // pad if needed
      for (let i=out.length;i<48;i++) {
        const d = new Date(Date.now()+i*3600000)
        d.setUTCMinutes(0,0,0)
        const diurnal = Math.sin((d.getUTCHours()/24)*Math.PI*2)
        const val = clampNumber(2 + diurnal, {min:0,max:50})
        out.push({ time: d.toISOString().replace(/:\d{2}\.\d{3}Z$/,':00:00Z'), value: Math.round(val*1000)/1000 })
      }
      return out
    }
    function hoursInMonthTs(d){return hoursInMonthUtc(d.getUTCFullYear(), d.getUTCMonth())}
    function normalizeMonthlyGroup(arr, startMonthDate) {
      const out = []
      const baseDate = new Date(startMonthDate)
      for (let i=0;i<12;i++) {
        const target = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth()+i,1,0,0,0))
        let item = arr && Array.isArray(arr) ? arr[i] : null
        let val = item ? item.value : null
        if (val == null) {
          // synthesize from typical hourly baseline 2.2 FWh with mild seasonality
          const hoursMonth = hoursInMonthTs(target)
            const season = 1 + 0.1*Math.cos((target.getUTCMonth()/12)*Math.PI*2)
          val = hoursMonth * (2.2 * season)
        }
        out.push({ month: target.toISOString().replace(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'T00:00:00Z'), value: clampNumber(val, {min:0, max: 24*hoursInMonthTs(target)}) })
      }
      return out
    }
    // New schema parsing
  let hourlyGroups = null, monthlyGroups = null, analysis = null
    if (parsed) {
      // Unwrap common wrappers (data, result, output)
      const unwrapKeys = ['data','result','output','response']
      for (const k of unwrapKeys) {
        if (parsed && typeof parsed === 'object' && parsed[k] && typeof parsed[k] === 'object' && !Array.isArray(parsed[k])) {
          // Merge shallow if it contains forecast keys
          if (Object.keys(parsed[k]).some(x => /hourly|monthly|analysis|generated/i.test(x))) {
            parsed = { ...parsed[k], analysis: parsed.analysis || parsed[k].analysis }
          }
        }
      }
      // Accept alternative key names for hourly groups
      const hourlyRaw = parsed.hourly_forecast_groups || parsed.hourlyForecastGroups || parsed.hourly_forecast || parsed.hourlyGroups || parsed.hourly || parsed.forecast_hourly || parsed.hourlyForecast
      // Accept alternative key names for monthly groups
      const monthlyRaw = parsed.monthly_forecast_groups || parsed.monthlyForecastGroups || parsed.monthly_forecast || parsed.monthlyGroups || parsed.monthly || parsed.forecast_monthly || parsed.monthlyForecast
      // Support array form: [{group:"28", data:[...]}, ...]
      function arrayToMap(raw) {
        if (Array.isArray(raw)) {
          const map = {}
          for (const entry of raw) {
            if (!entry) continue
            const gk = entry.group || entry.key || entry.id
            if (gk == null) continue
            map[gk] = entry.data || entry.values || entry.hourly || entry.monthly || entry.forecast || []
          }
          return map
        }
        return raw
      }
      const hourlySource = arrayToMap(hourlyRaw)
      const monthlySource = arrayToMap(monthlyRaw)
      // Canonicalize timestamp helper
      function canonTime(ts, isMonth=false) {
        if (!ts || typeof ts !== 'string') return null
        let d = new Date(ts)
        if (Number.isNaN(d.getTime())) return null
        d.setUTCMinutes(0,0,0)
        if (isMonth) { d.setUTCDate(1); d.setUTCHours(0) }
        return isMonth ? d.toISOString().replace(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'T00:00:00Z') : d.toISOString().replace(/:\d{2}\.\d{3}Z$/,':00:00:00Z')
      }
      if (hourlySource && typeof hourlySource === 'object') {
        hourlyGroups = {}
        for (const g of groupKeys) {
          let arr = hourlySource[g] || hourlySource[String(g)] || []
          if (!Array.isArray(arr) && typeof arr === 'object' && Array.isArray(arr.values)) arr = arr.values
          // Accept flat array of numbers
          if (Array.isArray(arr) && arr.length && typeof arr[0] === 'number') {
            arr = arr.map((v,i)=>({ time: new Date(Date.now()+i*3600000).toISOString().replace(/:\d{2}\.\d{3}Z$/,':00:00:00Z'), value: v }))
          }
          // Canonicalize times
          arr = arr.map(r=> ({ time: canonTime(r.time,false) || r.time || new Date().toISOString().replace(/:\d{2}\.\d{3}Z$/,':00:00:00Z'), value: r.value }))
          hourlyGroups[g] = normalizeHourlyGroup(arr)
        }
      }
      if (monthlySource && typeof monthlySource === 'object') {
        const nowD = new Date()
        const startNext = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth()+1,1,0,0,0))
        monthlyGroups = {}
        for (const g of groupKeys) {
          let arr = monthlySource[g] || monthlySource[String(g)] || []
          if (!Array.isArray(arr) && typeof arr === 'object' && Array.isArray(arr.values)) arr = arr.values
          if (Array.isArray(arr) && arr.length && typeof arr[0] === 'number') {
            // treat as monthly values only
            arr = arr.map((v,i)=>({ month: new Date(Date.UTC(startNext.getUTCFullYear(), startNext.getUTCMonth()+i,1,0,0,0)).toISOString().replace(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,'T00:00:00Z'), value: v }))
          }
          arr = arr.map(r=> ({ month: canonTime(r.month,true) || r.month || new Date(Date.UTC(startNext.getUTCFullYear(), startNext.getUTCMonth(),1,0,0,0)).toISOString().replace(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,'T00:00:00Z'), value: r.value }))
          monthlyGroups[g] = normalizeMonthlyGroup(arr, startNext)
        }
      }
      analysis = parsed.analysis || parsed.analysis_result || parsed.summary || null
      // Backward compatibility when only generated array exists
      if (!hourlyGroups && parsed.generated && Array.isArray(parsed.generated)) {
        hourlyGroups = {}
        for (const g of groupKeys) hourlyGroups[g] = normalizeHourlyGroup(parsed.generated)
      }
      if (!monthlyGroups && hourlyGroups) {
        const nowD = new Date()
        const startNext = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth()+1,1,0,0,0))
        monthlyGroups = {}
        for (const g of groupKeys) monthlyGroups[g] = normalizeMonthlyGroup([], startNext)
      }
      // Recursive salvage: look for any array of objects containing both time & value and treat as base hourly
      if (!hourlyGroups) {
        function findTimeSeries(obj) {
          if (!obj || typeof obj !== 'object') return null
          if (Array.isArray(obj)) {
            if (obj.length && typeof obj[0]==='object' && ('time' in obj[0] || 'timestamp' in obj[0]) && ('value' in obj[0] || 'val' in obj[0])) return obj
          }
          for (const v of Object.values(obj)) {
            const found = findTimeSeries(v)
            if (found) return found
          }
          return null
        }
        const series = findTimeSeries(parsed)
        if (series) {
          hourlyGroups = {}
          for (const g of groupKeys) hourlyGroups[g] = normalizeHourlyGroup(series.map(r=>({ time: r.time || r.timestamp, value: r.value || r.val })))
        }
      }
    }
    // Relaxed validation: pass through even if groups missing; attach raw text and parsed object
    const responsePayload = {
      result: 'hyper-generated-llm',
      hourly_forecast_groups: hourlyGroups || null,
      monthly_forecast_groups: monthlyGroups || null,
      analysis: analysis || null,
      raw_text: txt,
      raw_extracted: jsonPayloadText,
      parsed_original: parsed || null
    }
    if (hourlyGroups) {
      const firstGroupKey = Object.keys(hourlyGroups)[0]
      const len48 = hourlyGroups[firstGroupKey] ? hourlyGroups[firstGroupKey].length : 0
      const groupList = Object.keys(hourlyGroups)
      const generated = []
      for (let i=0;i<len48;i++) {
        const time = hourlyGroups[firstGroupKey][i].time
        let sum = 0, count = 0
        for (const g of groupList) {
          const item = hourlyGroups[g][i]
          if (item && typeof item.value === 'number') { sum += item.value; count++ }
        }
        const avgVal = count ? Math.round((sum / count)*1000)/1000 : 0
        generated.push({ time, value: avgVal })
      }
      responsePayload.generated = generated
    }
    return res.json(responsePayload)
  } catch (e) {
    console.error('hyper-train error', e)
    res.status(500).json({ error: 'Hyper train failed' })
  }
})

// Analyze uploaded training data using Gemini (or mock if not configured).
// POST /api/analyze-training
// Body: { lat?, lon?, ev? (percent), hours? (forecast horizon), extraNotes? }
app.post('/api/analyze-training', express.json(), async (req, res) => {
  try {
    if (!TRAINING_STORE.consumption || !TRAINING_STORE.prices || !TRAINING_STORE.groups) {
      return res.status(400).json({ error: 'No training data uploaded. Call /api/upload-training first.' })
    }

  const { lat, lon, ev, hours = 48, extraNotes, forecast: incomingForecast, answerStyle } = req.body || {}
  const wantText = (req.query && req.query.format === 'text')
  const style = (answerStyle || '').toLowerCase() === 'direct' ? 'direct' : 'structured'

    // build small summaries from training data to include in prompt
    const consum = TRAINING_STORE.consumption
    // compute simple aggregates: average, min, max, peak hour distribution (if timestamps present)
    let avg = 0, min = Infinity, max = -Infinity, count = 0
    const hourlySum = Array(24).fill(0)
    const hourlyCount = Array(24).fill(0)
    for (const row of consum) {
      // try to find a numeric total in row (many columns are groups); sum numeric columns
      const vals = Object.entries(row).slice(1).map(([k,v]) => Number(v) || 0)
      const total = vals.reduce((a,b)=>a+b,0)
      avg += total; count++
      if (total < min) min = total
      if (total > max) max = total
      // try parse timestamp
      const t = row.measured_at || row.measuredAt || Object.values(row)[0]
      const dt = new Date(t)
      if (!Number.isNaN(dt.getTime())) {
        const h = dt.getHours()
        hourlySum[h] += total
        hourlyCount[h] += 1
      }
    }
    avg = count ? (avg / count) : 0
    const hourlyAvg = hourlySum.map((s,i)=> hourlyCount[i] ? s / hourlyCount[i] : 0)
    const peakHour = hourlyAvg.indexOf(Math.max(...hourlyAvg))

    // fetch short weather forecast if lat/lon provided
    let weatherSample = null
    if (lat !== undefined && lon !== undefined) {
      try {
        const params = new URLSearchParams({ latitude: String(lat), longitude: String(lon), hourly: 'temperature_2m', timezone: 'auto', past_days: '0' })
        const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`
        const r = await fetch(url)
        if (r.ok) {
          const w = await r.json()
          weatherSample = { timezone: w.timezone, hourly_keys: Object.keys(w.hourly || {}).slice(0,5) }
        }
      } catch (e) { /* ignore */ }
    }

    // price sample
    const priceSample = TRAINING_STORE.prices.slice(0,6)

    const wantCsv = (req.query && req.query.format === 'csv')
    let prompt = ''
    if (!wantCsv) {
      // Prepare compact training samples (first few rows) for context
      const consumptionSample = TRAINING_STORE.consumption.slice(0,3).map(r=>({ measured_at: r.measured_at||r.measuredAt||Object.values(r)[0] })).map((base,i)=>{
        // add first three numeric sums for hint (avoid huge payload)
        const row = TRAINING_STORE.consumption[i]
        const nums = Object.entries(row).slice(1).map(([k,v])=>Number(v)||0)
        return { ...base, total_hint: nums.slice(0,5).reduce((a,b)=>a+b,0) }
      })
      const groupSample = TRAINING_STORE.groups ? TRAINING_STORE.groups.slice(0,2) : []
      // naive next-month forecast: use average hourly * hours in next month
      const nowDt = new Date()
      const nextMonthHours = hoursInMonthUtc(nowDt.getUTCFullYear(), (nowDt.getUTCMonth()+1)%12)
      const naiveNextMonth = Math.round(avg * nextMonthHours * 100)/100
      const wantsMonthly = extraNotes && /next month|monthly|month ahead/i.test(extraNotes)
      if (style === 'direct') {
        const directPieces = [
          'You are an energy analytics assistant. Provide a concise direct answer to the user question below using the training data context.',
          `Context aggregates: avg=${Math.round(avg*100)/100}, min=${Math.round(min*100)/100}, max=${Math.round(max*100)/100}, peakHour=${peakHour}.`,
          `Hourly pattern (0-23 avg): ${hourlyAvg.map(v=>Math.round(v*100)/100).join(',')}.`,
          `Consumption sample (timestamps + total hints): ${JSON.stringify(consumptionSample)}.`,
          `Price sample: ${JSON.stringify(priceSample.slice(0,3))}.`,
          groupSample.length ? `Group sample: ${JSON.stringify(groupSample)}` : null,
          weatherSample ? `Weather keys: ${JSON.stringify(weatherSample)}.` : null,
          (ev !== undefined) ? `EV uptake percent: ${ev}.` : null,
          wantsMonthly ? `Naive next-month total estimate (baseline): ${naiveNextMonth} FWh.` : null,
          extraNotes ? `User question: ${extraNotes}` : 'User question: Provide a short high-level insight.',
          'If the question seeks a monthly forecast and data is insufficient for granular monthly trend, use the naive estimate and explain briefly. Respond with a short paragraph or bullet list only; do NOT output JSON unless explicitly asked.'
        ].filter(Boolean)
        prompt = directPieces.join('\n')
      } else {
        const promptPieces = [
          'You are an energy analytics assistant. Analyze the uploaded training data and produce a JSON object with keys: summary, drivers, recommendations, generated_forecast (48 hourly values), and if requested (question mentions next month), add monthly_estimate {next_month_total}.',
          `Training aggregates: avg=${Math.round(avg*100)/100}, min=${Math.round(min*100)/100}, max=${Math.round(max*100)/100}, peakHour=${peakHour}.`,
          `Hourly averages (0-23): ${hourlyAvg.map(v=>Math.round(v*100)/100).join(',')}.`,
          `Consumption sample (timestamps + total hints): ${JSON.stringify(consumptionSample)}.`,
          `Price sample: ${JSON.stringify(priceSample.slice(0,3))}.`,
          groupSample.length ? `Group sample: ${JSON.stringify(groupSample)}` : null,
        ]
        if (weatherSample) promptPieces.push(`Weather info keys: ${JSON.stringify(weatherSample)}.`)
        if (ev !== undefined) promptPieces.push(`Assumed EV uptake percent: ${ev}.`)
        if (wantsMonthly) promptPieces.push(`Naive baseline next month total estimate: ${naiveNextMonth} FWh.`)
        if (extraNotes) promptPieces.push(`Notes: ${extraNotes}`)
        promptPieces.push('Return ONLY a single valid JSON object. No explanations. generated_forecast should be an array of {time,value} for the next 48 hours. If monthly_estimate requested include monthly_estimate key.')
        prompt = promptPieces.filter(Boolean).join('\n')
      }
    } else {
      // CSV request: instruct model to output two semicolon-delimited CSV blocks
      const csvInstr = [
        'You are an energy analytics assistant. Produce TWO CSV outputs ONLY in semicolon-delimited form.',
        'First CSV (HOURLY): 48 rows for next 48 hours. Header: measured_at;VALUE. Use ISO timestamps (UTC) for measured_at. VALUE is a single aggregated consumption prediction number.',
        'Second CSV (MONTHLY): 12 rows for next 12 months (first day of each month). Header: measured_at;VALUE.',
        `Context aggregates avg=${Math.round(avg*100)/100}, min=${Math.round(min*100)/100}, max=${Math.round(max*100)/100}, peakHour=${peakHour}.`,
  'Output format EXACTLY:','HOURLY_START','measured_at;VALUE','<48 data rows>','HOURLY_END','MONTHLY_START','measured_at;VALUE','<12 data rows>','MONTHLY_END',
  'No commentary, no JSON, only the CSV blocks with the given markers.'
      ]
      if (extraNotes) csvInstr.push(`Notes: ${extraNotes}`)
      prompt = csvInstr.join('\n')
    }

    // call Gemini similar to train-ai-llm logic, but prefer GEMINI_ACCESS_TOKEN, then GEMINI_API_KEY
    const geminiUrl = process.env.GEMINI_API_URL
    const accessToken = process.env.GEMINI_ACCESS_TOKEN
    const apiKey = process.env.GEMINI_API_KEY

    // If no gemini config, fall back to local heuristic analysis
    if (!geminiUrl) {
      const summary = { avg: Math.round(avg*100)/100, min: Math.round(min*100)/100, max: Math.round(max*100)/100, peakHour }
      if (wantText) {
        if (style === 'direct') {
          const lines = []
          lines.push('Direct insight:')
          lines.push(`• Baseline hourly load ~${summary.avg} FWh (range ${summary.min} – ${summary.max}).`)
          lines.push(`• Peak hour around ${summary.peakHour}:00.`)
          if (typeof ev === 'number') lines.push(`• EV uptake ~${ev}% may slightly elevate evening demand.`)
          if (extraNotes) lines.push(`• Question focus: ${extraNotes}`)
          return res.json({ result: 'mock-analysis-direct', answer: lines.join('\n') })
        }
        const parts = []
        parts.push(`Here’s a quick read based on your data:`)
        parts.push(`• Average hourly load ~${summary.avg} FWh (min ${summary.min}, max ${summary.max}).`)
        parts.push(`• Peak tends to occur around ${summary.peakHour}:00.`)
        if (typeof ev === 'number') parts.push(`• With ~${ev}% EV uptake, expect slightly higher evening demand.`)
        if (extraNotes) parts.push(`Prompt: ${extraNotes}`)
        return res.json({ result: 'mock-analysis-text', answer: parts.join('\n') })
      } else {
        const local = {
          summary,
          drivers: ['daily pattern', 'temperature', 'EV uptake (if any)'],
          recommendations: ['Shift flexible loads to low-price hours', 'Investigate peak-hour demand reduction'],
          generated_forecast: []
        }
        return res.json({ result: 'mock-analysis', analysis: local })
      }
    }

    // build request body depending on endpoint pattern
    let body = null
    if (geminiUrl.includes('generateText')) {
      body = { prompt, temperature: 0.1, maxOutputTokens: 800 }
    } else if (geminiUrl.includes('generateContent')) {
      body = { contents: [{ parts: [{ text: prompt }] }] }
    } else {
      body = { prompt }
    }

    const headers = { 'Content-Type': 'application/json' }
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
    else if (apiKey) headers['X-goog-api-key'] = apiKey

    const resp = await fetch(geminiUrl, { method: 'POST', headers, body: JSON.stringify(body) })
    const txt = await resp.text()
    if (!resp.ok) {
      console.error('gemini analyze error', txt)
      return res.status(502).json({ error: 'Gemini call failed', details: txt })
    }

    // Guardrail helpers ----------------------------------------------------
    function sanitizeNumber(n, fallback = 0, { min = 0, max = 1e9 } = {}) {
      const v = Number(n)
      if (Number.isNaN(v)) return fallback
      return Math.min(max, Math.max(min, v))
    }
    function isIso(t) { return typeof t === 'string' && /\d{4}-\d{2}-\d{2}T/.test(t) && !Number.isNaN(new Date(t).getTime()) }
    function buildSyntheticForecast(len = 48) {
      const out = []
      const start = Date.now()
      for (let i=0;i<len;i++) {
        const d = new Date(start + i*3600000)
        const h = d.getUTCHours()
        const diurnal = Math.sin((h/24)*Math.PI*2)
        const val = Math.max(0, 2 + diurnal)
        out.push({ time: d.toISOString(), value: Math.round(val*1000)/1000 })
      }
      return out
    }
    function sanitizeForecast(f) {
      if (!Array.isArray(f)) return buildSyntheticForecast()
      // keep first 48, ensure shape, numeric bounds ~0..50 FWh (arbitrary upper clamp)
      const cleaned = []
      for (let i=0;i<Math.min(48,f.length);i++) {
        const item = f[i]
        const time = item && isIso(item.time) ? item.time : new Date(Date.now()+i*3600000).toISOString()
        const value = sanitizeNumber(item && item.value, 0, { min: 0, max: 50 })
        cleaned.push({ time, value })
      }
      // if too short, pad
      for (let i=cleaned.length;i<48;i++) cleaned.push(buildSyntheticForecast(48 - cleaned.length)[0])
      return cleaned
    }
    function sanitizeAnalysisObject(obj) {
      if (!obj || typeof obj !== 'object') return { summary: { avg: 0, min: 0, max: 0, peakHour: 0 }, drivers: [], recommendations: [], generated_forecast: buildSyntheticForecast() }
      const summary = obj.summary && typeof obj.summary === 'object' ? obj.summary : {}
      const sanitizedSummary = {
        avg: sanitizeNumber(summary.avg, 0, { min: 0, max: 100000 }),
        min: sanitizeNumber(summary.min, 0, { min: 0, max: 100000 }),
        max: sanitizeNumber(summary.max, 0, { min: 0, max: 100000 }),
        peakHour: (()=>{ const ph = sanitizeNumber(summary.peakHour, 0, { min: 0, max: 23 }); return Math.round(ph) })()
      }
      // Ensure logical min<=avg<=max
      if (sanitizedSummary.min > sanitizedSummary.avg) sanitizedSummary.min = sanitizedSummary.avg
      if (sanitizedSummary.avg > sanitizedSummary.max) sanitizedSummary.max = sanitizedSummary.avg
      const drivers = Array.isArray(obj.drivers) ? obj.drivers.slice(0,8).map(d=>String(d).slice(0,80)) : []
      const recommendations = Array.isArray(obj.recommendations) ? obj.recommendations.slice(0,8).map(r=>String(r).slice(0,120)) : []
      const forecast = sanitizeForecast(obj.generated_forecast || obj.forecast)
      return { summary: sanitizedSummary, drivers, recommendations, generated_forecast: forecast }
    }

    if (wantText && style === 'direct') {
      // Direct answer path: try structured parse for prettier multiline insight.
      const perhapsJson = txt.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
      if (!perhapsJson) {
        return res.json({ result: 'gemini-analysis-direct', answer: txt.trim() })
      }
      let parsed = null
      try { parsed = JSON.parse(perhapsJson[0]) } catch (e) { parsed = null }
      if (parsed && parsed.summary) {
        // Reuse guardrail sanitizer for consistency
        const safe = sanitizeAnalysisObject(parsed)
        const s = safe.summary
        const lines = []
        lines.push('Direct insight:')
        lines.push(`• Baseline hourly load ~${s.avg} FWh (range ${s.min} – ${s.max}).`)
        lines.push(`• Peak hour around ${s.peakHour}:00 UTC.`)
        if (safe.drivers.length) lines.push(`• Key drivers: ${safe.drivers.slice(0,3).join(', ')}.`)
        if (safe.recommendations.length) lines.push(`• Priority action: ${safe.recommendations[0]}`)
        return res.json({ result: 'gemini-analysis-direct', answer: lines.join('\n'), raw: txt })
      }
      return res.json({ result: 'gemini-analysis-direct', answer: txt.trim() })
    }
    if (wantText) {
      // Attempt to parse JSON, sanitize, then render curated prose; fallback to raw trimmed text.
      let parsed = null
      const maybeJson = txt.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
      if (maybeJson) {
        try { parsed = JSON.parse(maybeJson[0]) } catch (e) { parsed = null }
      }
      if (parsed) {
        const safe = sanitizeAnalysisObject(parsed)
        const s = safe.summary
        const lines = []
        lines.push('Energy training data insight:')
        lines.push(`• Baseline hourly load ~${s.avg} FWh (range ${s.min} – ${s.max}).`)
        lines.push(`• Peak hour tendency: ${s.peakHour}:00 UTC.`)
        if (safe.drivers.length) lines.push(`• Key drivers: ${safe.drivers.join(', ')}.`)
        if (safe.recommendations.length) {
          lines.push('• Recommendations:')
          safe.recommendations.forEach(r=> lines.push(`  - ${r}`))
        }
        // Forecast snippet (first 6 values)
        const snippet = safe.generated_forecast.slice(0,6).map(x=>`${x.value}`).join(', ')
        lines.push(`• 48h forecast (first 6 values FWh): ${snippet}`)
        return res.json({ result: 'gemini-analysis-text', answer: lines.join('\n'), raw: txt })
      }
      // fallback: treat plain text
      return res.json({ result: 'gemini-analysis-text', answer: txt.trim() })
    } else if (!wantCsv) {
      // Structured JSON path with guardrails
      let parsed = null
      try { parsed = JSON.parse(txt) } catch (e) {
        const m = txt.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
        if (m) { try { parsed = JSON.parse(m[0]) } catch (e2) { parsed = null } }
      }
      if (!parsed) return res.status(502).json({ error: 'Gemini did not return JSON', raw: txt })
      const sanitized = sanitizeAnalysisObject(parsed)
      return res.json({ result: 'gemini-analysis', raw: txt, analysis: sanitized })
    } else {
      // CSV path: extract between markers
      const hourlyBlock = txt.match(/HOURLY_START[\s\S]*?HOURLY_END/)
      const monthlyBlock = txt.match(/MONTHLY_START[\s\S]*?MONTHLY_END/)
      if (!hourlyBlock || !monthlyBlock) {
        return res.status(502).json({ error: 'Gemini did not return expected CSV blocks', raw: txt })
      }
      const hourlyCsv = hourlyBlock[0]
        .replace('HOURLY_START','')
        .replace('HOURLY_END','')
        .trim()
      const monthlyCsv = monthlyBlock[0]
        .replace('MONTHLY_START','')
        .replace('MONTHLY_END','')
        .trim()
      return res.json({ result: 'gemini-analysis-csv', hourly_csv: hourlyCsv, monthly_csv: monthlyCsv })
    }
  } catch (err) {
    console.error('analyze-training error', err)
    res.status(500).json({ error: 'Analysis failed' })
  }
})

const port = process.env.PORT || 4000
const server = app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`)
  // Attempt to auto-load the most recent upload into memory so files copied to uploads/ are recognized
  if (UPLOADS && UPLOADS.length > 0) {
    try {
      const latest = UPLOADS[0]
      const ok = loadUploadIntoMemory(latest)
      if (!ok) console.warn('Auto-load of latest upload failed; call /api/load-upload to try manually')
    } catch (e) { console.error('Auto-load error', e) }
  }
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Kill the process using it or set PORT to a different value.`)
  } else {
    console.error('Server error:', err)
  }
  process.exit(1)
})
