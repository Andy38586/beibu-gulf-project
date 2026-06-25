import { Router } from 'express'
import * as siteAnalysisController from '../controllers/siteAnalysisController.js'

const router = Router()

router.post('/', siteAnalysisController.analyze)

export default router
