import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useProfileStore = defineStore('profile', () => {
  const selectedProfileId = ref(null)
  const profileActive = ref(false)

  function setSelectedProfile(profileId) {
    selectedProfileId.value = profileId
    profileActive.value = !!profileId
  }

  function resetProfile() {
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
