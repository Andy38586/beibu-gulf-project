import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import markersRouter from './routes/markers.js'
import facilitiesRouter from './routes/facilities.js'
import siteAnalysisRouter from './routes/siteAnalysis.js'
import authRouter from './routes/auth.js'
import plansRouter from './routes/plans.js'

const app = express()

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json())
app.use(cookieParser())
app.use('/api/markers', markersRouter)
app.use('/api/facilities', facilitiesRouter)
app.use('/api/site-analysis', siteAnalysisRouter)
app.use('/api/auth', authRouter)
app.use('/api/plans', plansRouter)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

// AUDIT-009 (错误): 404错误处理中间件
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' })
})

export default app
