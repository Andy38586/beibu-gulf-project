/**
 * 碳排放分析状态管理（独立 Store，不污染其他模块）
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useCarbonState = defineStore('carbon', () => {
  const selectedYear = ref('2025')
  const ports = ref([])
  const emissionData = ref(null)
  const isLoading = ref(false)

  function setSelectedYear(year) {
    selectedYear.value = year
  }

  function setEmissionData(data) {
    emissionData.value = data
    ports.value = data.ports || []
  }

  function reset() {
    selectedYear.value = '2025'
    ports.value = []
    emissionData.value = null
    isLoading.value = false
  }

  return {
    selectedYear,
    ports,
    emissionData,
    isLoading,
    setSelectedYear,
    setEmissionData,
    reset,
  }
})
