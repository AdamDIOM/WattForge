import { useEffect, useRef } from 'react'
import Chart from 'chart.js/auto'

export default function ForecastChart({ data }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || !data) return
    const ctx = canvasRef.current.getContext('2d')
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(d => new Date(d.time).toLocaleString()),
        datasets: [{ label: 'Predicted consumption (FWh)', data: data.map(d => d.value), borderColor: '#2563EB', backgroundColor: 'rgba(59,130,246,0.2)' }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    })

    return () => chart.destroy()
  }, [data])

  return <div style={{ height: 300 }}><canvas ref={canvasRef} /></div>
}
