import * as markersRepo from '../repositories/markersRepository.js'

export async function getAll(req, res) {
  try {
    // BUGFIX-P0-02: 只返回当前用户的标记
    const markers = await markersRepo.findByUserId(req.user.id)
    res.json(markers)
  } catch (error) {
    console.error('获取标注列表失败:', error)
    res.status(500).json({ error: '获取标注列表失败' })
  }
}
export async function getOne(req, res) {
  try {
    const marker = await markersRepo.findById(req.params.id)
    if (!marker) {
      return res.status(404).json({ error: '标注不存在' })
    }
    res.json(marker)
  } catch (error) {
    console.error('获取标注失败:', error)
    res.status(500).json({ error: '获取标注失败' })
  }
}
export async function createOne(req, res) {
  try {
    const { name, lng, lat, note } = req.body

    if (!name || lng === undefined || lat === undefined) {
      return res.status(400).json({ error: '缺少必要字段: name, lng, lat' })
    }
    // BUGFIX-P0-02: 归属强制取自登录身份，不接受客户端传入
    const newMarker = await markersRepo.create({ name, lng, lat, note: note || '', userId: req.user.id })
    res.status(201).json(newMarker)
  } catch (error) {
    console.error('创建标注失败:', error)
    res.status(500).json({ error: '创建标注失败' })
  }
}
export async function updateOne(req, res) {
  try {
    // BUGFIX-P0-02: 归属校验，非本人标记返回 403
    const existing = await markersRepo.findById(req.params.id)
    if (!existing) {
      return res.status(404).json({ error: '标注不存在' })
    }
    if (existing.userId !== req.user.id) {
      return res.status(403).json({ error: '无权操作他人标注' })
    }
    const updated = await markersRepo.update(req.params.id, req.body)
    if (!updated) {
      return res.status(404).json({ error: '标注不存在' })
    }
    res.json(updated)
  } catch (error) {
    console.error('更新标注失败:', error)
    res.status(500).json({ error: '更新标注失败' })
  }
}
export async function deleteOne(req, res) {
  try {
    // BUGFIX-P0-02: 归属校验，非本人标记返回 403
    const existing = await markersRepo.findById(req.params.id)
    if (!existing) {
      return res.status(404).json({ error: '标注不存在' })
    }
    if (existing.userId !== req.user.id) {
      return res.status(403).json({ error: '无权操作他人标注' })
    }
    const success = await markersRepo.remove(req.params.id)
    if (!success) {
      return res.status(404).json({ error: '标注不存在' })
    }
    res.status(204).send()
  } catch (error) {
    console.error('删除标注失败:', error)
    res.status(500).json({ error: '删除标��失败' })
  }
}
