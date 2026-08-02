import { defineStore } from 'pinia'
import type { Ref } from 'vue'
import { ref } from 'vue'

export const useProfileStore = defineStore('profile', () => {
  const selectedProfileId: Ref<string | null> = ref(null)
  const profileActive: Ref<boolean> = ref(false)

  // LIF-3：*Active 单向置位——null 显式同步为 false
  function setSelectedProfile(profileId: string | null): void {
    selectedProfileId.value = profileId
    profileActive.value = profileId !== null
  }

  function resetProfile(): void {
    selectedProfileId.value = null
    profileActive.value = false
  }

  return {
    selectedProfileId,
    profileActive,
    setSelectedProfile,
    resetProfile,
  }
})
