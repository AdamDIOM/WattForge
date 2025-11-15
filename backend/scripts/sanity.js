const fetch = require('node-fetch')

async function run() {
  try {
    console.log('Checking training load...')
    const c = await fetch('http://localhost:4000/api/check-training')
    const cj = await c.json()
    console.log('check-training:', cj)

    if (cj.loaded) {
      console.log('Running sanity-check...')
      const s = await fetch('http://localhost:4000/api/sanity-check')
      const sj = await s.json()
      console.log('sanity-check sample:', sj)
    } else {
      console.log('No training data loaded. Use /api/load-upload or upload a workbook.')
    }
  } catch (e) {
    console.error('Sanity script failed', e)
    process.exit(1)
  }
}

run()
