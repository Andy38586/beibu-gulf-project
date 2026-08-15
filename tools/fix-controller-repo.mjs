// 6-05: controllers 直读 readStaticJson → repository 收口(flood/forecast/ports)
import fs from 'node:fs'

// 1. floodAnalysisController
const f1 = 'backend/controllers/floodAnalysisController.js'
let t1 = fs.readFileSync(f1, 'utf8')
t1 = t1.replace(
  "import { readStaticJson } from '../utils/readStaticJson.js'",
  "import { readFacilityPoints, readFloodArea, readFloodStatistics, readTerrainProfile, readWaterArea } from '../repositories/floodRepository.js'"
)
t1 = t1.replace("readStaticJson('flood/floodArea.json')", 'readFloodArea()')
t1 = t1.replace("readStaticJson('flood/floodStatistics.json')", 'readFloodStatistics()')
t1 = t1.replace("readStaticJson('flood/terrainProfile.json')", 'readTerrainProfile()')
t1 = t1.replace("readStaticJson('flood/water-area.json')", 'readWaterArea()')
t1 = t1.replace("readStaticJson('flood/facilityPoints.json')", 'readFacilityPoints()')
fs.writeFileSync(f1, t1, 'utf8')
console.log('floodAnalysisController 收口完成')

// 2. forecastController
const f2 = 'backend/controllers/forecastController.js'
let t2 = fs.readFileSync(f2, 'utf8')
if (t2.includes("readStaticJson('forecast/index.json')")) {
  t2 = t2.replace("import { readStaticJson } from '../utils/readStaticJson.js'", "import { readForecastIndex } from '../repositories/forecastRepository.js'")
  t2 = t2.replace("readStaticJson('forecast/index.json')", 'readForecastIndex()')
  fs.writeFileSync(f2, t2, 'utf8')
  console.log('forecastController 收口完成')
} else {
  console.log('⚠️ forecastController 无 index.json 读取, 跳过')
}

// 3. portsController
const f3 = 'backend/controllers/portsController.js'
let t3 = fs.readFileSync(f3, 'utf8')
if (t3.includes("readStaticJson('ports.json')")) {
  t3 = t3.replace("import { readStaticJson } from '../utils/readStaticJson.js'", "import { readPorts } from '../repositories/portsRepository.js'")
  t3 = t3.replace("readStaticJson('ports.json')", 'readPorts()')
  fs.writeFileSync(f3, t3, 'utf8')
  console.log('portsController 收口完成')
} else {
  console.log('⚠️ portsController 无 ports.json 读取, 跳过')
}
