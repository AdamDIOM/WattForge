import { useState } from 'react'

const FIN_CITIES = [
  { name: 'Helsinki, Finland', lat: 60.1699, lon: 24.9384 },
  { name: 'Espoo, Finland', lat: 60.2055, lon: 24.6559 },
  { name: 'Tampere, Finland', lat: 61.4978, lon: 23.7610 },
  { name: 'Turku, Finland', lat: 60.4518, lon: 22.2666 },
  { name: 'Oulu, Finland', lat: 65.0121, lon: 25.4682 }
]

export default function CitySelector({ onSelect }) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])

  function searchNominatim(q) {
    if (!q) { setSuggestions([]); return }
    fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(data => setSuggestions(data))
      .catch(() => setSuggestions([]))
  }

  return (
    <div>
      <select className="w-full p-2 border rounded" onChange={(e) => {
        const idx = e.target.value
        if (idx === '__custom') return
        const c = FIN_CITIES[Number(idx)]
        if (c) onSelect(c.lat, c.lon)
      }}>
        {FIN_CITIES.map((c, i) => (
          <option key={c.name} value={i}>{c.name}</option>
        ))}
        <option value="__custom">Search other...</option>
      </select>

      <div className="mt-2">
        <input value={query} onChange={(e) => { setQuery(e.target.value); searchNominatim(e.target.value) }} placeholder="Search city or region" className="w-full p-2 border rounded" />
        {suggestions.length > 0 && (
          <ul className="mt-2 bg-white border rounded max-h-40 overflow-auto">
            {suggestions.map(s => (
              <li key={s.place_id} className="p-2 hover:bg-slate-100 cursor-pointer" onClick={() => { onSelect(parseFloat(s.lat), parseFloat(s.lon)); setSuggestions([]); setQuery('') }}>{s.display_name}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
