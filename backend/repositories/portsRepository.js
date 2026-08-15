/**
 * portsRepository — 港口数据访问层（6-05 六层契约收口）
 */
import { readStaticJson } from '../utils/readStaticJson.js'

/** 港口目录（ports.json，经 GET /api/ports 返回） */
export const readPorts = () => readStaticJson('ports.json')
