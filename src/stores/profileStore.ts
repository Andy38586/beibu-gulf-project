import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Ref } from 'vue'

export const useProfileStore = defineStore('profile', () => {
  const selectedProfileId: Ref<string | null> = ref(null)
  const profileActive: Ref<boolean> = ref(false)

  function setSelectedProfile(profileId: string | null): void {
    selectedProfileId.value = profileId
    if (profileId) {
      profileActive.value = true
    }
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
