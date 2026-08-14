// d080: plansController 直连仓库 → plansService 收口
import fs from 'node:fs'
const p = 'backend/controllers/plansController.js'
let t = fs.readFileSync(p, 'utf8')
const subs = [
  ["import * as plansRepo from '../repositories/plansRepository.js'", "import * as plansService from '../services/plansService.js'"],
  ['plansRepo.findAllByUserId(req.user.id)', 'plansService.listByUser(req.user.id)'],
  ['plansRepo.findById(req.params.id)', 'plansService.getById(req.params.id)'],
  ['plansRepo.create({', 'plansService.create({'],
  ['plansRepo.update(req.params.id, updates)', 'plansService.update(req.params.id, updates)'],
  ['plansRepo.remove(req.params.id)', 'plansService.remove(req.params.id)'],
  ['plansRepo.saveXiaoqu(req.params.id, xiaoqu)', 'plansService.saveXiaoqu(req.params.id, xiaoqu)'],
  ['plansRepo.removeXiaoqu(req.params.id, req.params.xiaoquId)', 'plansService.removeXiaoqu(req.params.id, req.params.xiaoquId)'],
]
let n = 0
for (const [a, b] of subs) {
  const re = new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  const before = t
  t = t.replace(re, b)
  if (t !== before) n++
}
fs.writeFileSync(p, t, 'utf8')
console.log(`替换 ${n} 处`)
