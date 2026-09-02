import { describe, expect, it } from 'vitest'

import { isProfilePath } from '../useProfileSnapshot'

describe('isProfilePath', () => {
  it('仅 /profile 判定为个人中心路径', () => {
    expect(isProfilePath('/profile')).toBe(true)
  })

  it('业务页与首页不是个人中心路径', () => {
    expect(isProfilePath('/')).toBe(false)
    expect(isProfilePath('/site-selection')).toBe(false)
    expect(isProfilePath('/forecast')).toBe(false)
  })

  it('按 path 比对（守卫消费的是 to.path，不含 query/hash）', () => {
    expect(isProfilePath('/profile?redirect=/site-selection')).toBe(false)
    expect(isProfilePath('/profile#section')).toBe(false)
  })
})