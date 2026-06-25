import express from 'express'
import cors from 'cors'
import markersRouter from './routes/markers.js'
import facilitiesRouter from './routes/facilities.js'
import siteAnalysisRouter from './routes/siteAnalysis.js'

const app = express()

app.use(cors())
app.use(express.json())
app.use('/api/markers', markersRouter)
app.use('/api/facilities', facilitiesRouter)
app.use('/api/site-analysis', siteAnalysisRouter)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})
export default app
