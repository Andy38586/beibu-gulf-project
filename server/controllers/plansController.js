import * as plansRepo from '../repositories/plansRepository.js'

export async function getAll(req, res) {
  try {
    const plans = await plansRepo.findAllByUserId(req.user.id)
    res.json(plans)
  } catch (error) {
    console.error('获取方案列表失败:', error)
    res.status(500).json({ error: '获取方案列表失败' })
  }
}

export async function getOne(req, res) {
  try {
    const plan = await plansRepo.findById(req.params.id)
    if (!plan) {
      return res.status(404).json({ error: '方案不存在' })
    }
    if (plan.userId !== req.user.id) {
      return res.status(403).json({ error: '无权访问该方案' })
    }
    res.json(plan)
  } catch (error) {
    console.error('获取方案失败:', error)
    res.status(500).json({ error: '获取方案失败' })
  }
}

export async function createOne(req, res) {
  try {
    const { name, selectedKeys, typeSettings, weights } = req.body

    if (!name || !selectedKeys) {
      return res.status(400).json({ error: '缺少必要字段: name, selectedKeys' })
    }
    const newPlan = await plansRepo.create({
      userId: req.user.id,
      name,
      selectedKeys,
      typeSettings: typeSettings || {},
      weights: weights || null,
    })
    res.status(201).json(newPlan)
  } catch (error) {
    console.error('创建方案失败:', error)
    res.status(500).json({ error: '创建方案失败' })
  }
}

export async function updateOne(req, res) {
  try {
    const plan = await plansRepo.findById(req.params.id)
    if (!plan) {
      return res.status(404).json({ error: '方案不存在' })
    }
    if (plan.userId !== req.user.id) {
      return res.status(403).json({ error: '无权修改该方案' })
    }
    const { name, selectedKeys, typeSettings, weights } = req.body
    const updates = {}
    if (name !== undefined) updates.name = name
    if (selectedKeys !== undefined) updates.selectedKeys = selectedKeys
    if (typeSettings !== undefined) updates.typeSettings = typeSettings
    if (weights !== undefined) updates.weights = weights

    const updated = await plansRepo.update(req.params.id, updates)
    res.json(updated)
  } catch (error) {
    console.error('更新方案失败:', error)
    res.status(500).json({ error: '更新方案失败' })
  }
}

export async function deleteOne(req, res) {
  try {
    const plan = await plansRepo.findById(req.params.id)
    if (!plan) {
      return res.status(404).json({ error: '方案不存在' })
    }
    if (plan.userId !== req.user.id) {
      return res.status(403).json({ error: '无权删除该方案' })
    }
    const success = await plansRepo.remove(req.params.id)
    if (!success) {
      return res.status(404).json({ error: '方案不存在' })
    }
    res.status(204).send()
  } catch (error) {
    console.error('删除方案失败:', error)
    res.status(500).json({ error: '删除方案失败' })
  }
}
