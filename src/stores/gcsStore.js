import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * GCS三维港口分析系统状态管理
 * 
 * 管理四个业务模块的状态：
 * 1. 水位模拟（WaterLevelSimulation）
 * 2. 剖面分析（ProfileAnalysis）
 * 3. 淹没分析（FloodRiskAnalysis）
 * 4. 港口影响分析（PortImpactAssessment）
 */
export const useGcsStore = defineStore('gcs', () => {
  // ==================== 水位模拟状态 ====================
  /** 当前水位高度（米） */
  const waterLevel = ref(0)
  /** 水位模拟是否激活 */
  const waterLevelActive = ref(false)

  /**
   * 设置水位高度
   * @param {number} level - 水位高度（米）
   */
  function setWaterLevel(level) {
    waterLevel.value = level
    waterLevelActive.value = level > 0
  }

  /**
   * 重置水位
   */
  function resetWaterLevel() {
    waterLevel.value = 0
    waterLevelActive.value = false
  }

  // ==================== 剖面分析状态 ====================
  /** 当前选中的剖面线ID */
  const selectedProfileId = ref(null)
  /** 剖面分析是否激活 */
  const profileActive = ref(false)

  /**
   * 设置选中的剖面线
   * @param {string} profileId - 剖面线ID
   */
  function setSelectedProfile(profileId) {
    selectedProfileId.value = profileId
    profileActive.value = !!profileId
  }

  /**
   * 重置剖面分析
   */
  function resetProfile() {
    selectedProfileId.value = null
    profileActive.value = false
  }

  // ==================== 淹没分析状态 ====================
  /** 淹没分析是否激活 */
  const floodActive = ref(false)
  /** 是否显示淹没范围 */
  const showFloodArea = ref(false)
  /** 是否显示受影响POI */
  const showFloodPOI = ref(false)

  /**
   * 启动淹没分析
   */
  function startFloodAnalysis() {
    floodActive.value = true
    showFloodArea.value = true
    showFloodPOI.value = true
  }

  /**
   * 重置淹没分析
   */
  function resetFloodAnalysis() {
    floodActive.value = false
    showFloodArea.value = false
    showFloodPOI.value = false
  }

  // ==================== 港口影响分析状态 ====================
  /** 港口影响分析是否激活 */
  const portImpactActive = ref(false)
  /** 受影响设施列表 */
  const affectedFacilities = ref([])
  /** 预估总损失（万元） */
  const totalLoss = ref(0)

  /**
   * 设置港口影响分析结果
   * @param {Array} facilities - 受影响设施列表
   * @param {number} loss - 预估总损失
   */
  function setPortImpactResult(facilities, loss) {
    affectedFacilities.value = facilities
    totalLoss.value = loss
    portImpactActive.value = facilities.length > 0
  }

  /**
   * 重置港口影响分析
   */
  function resetPortImpact() {
    affectedFacilities.value = []
    totalLoss.value = 0
    portImpactActive.value = false
  }

  // ==================== 全局状态 ====================
  /** 当前激活的业务模块 */
  const activeModule = ref(null)

  /**
   * 设置当前激活的业务模块
   * @param {string} moduleName - 模块名称：'waterLevel' | 'profile' | 'flood' | 'portImpact'
   */
  function setActiveModule(moduleName) {
    activeModule.value = moduleName
  }

  /**
   * 重置所有状态
   */
  function resetAll() {
    resetWaterLevel()
    resetProfile()
    resetFloodAnalysis()
    resetPortImpact()
    activeModule.value = null
  }

  // ==================== 计算属性 ====================
  /** 是否有任何分析正在激活 */
  const hasActiveAnalysis = computed(() => {
    return waterLevelActive.value || 
           profileActive.value || 
           floodActive.value || 
           portImpactActive.value
  })

  return {
    // 水位模拟
    waterLevel,
    waterLevelActive,
    setWaterLevel,
    resetWaterLevel,
    
    // 剖面分析
    selectedProfileId,
    profileActive,
    setSelectedProfile,
    resetProfile,
    
    // 淹没分析
    floodActive,
    showFloodArea,
    showFloodPOI,
    startFloodAnalysis,
    resetFloodAnalysis,
    
    // 港口影响
    portImpactActive,
    affectedFacilities,
    totalLoss,
    setPortImpactResult,
    resetPortImpact,
    
    // 全局
    activeModule,
    setActiveModule,
    resetAll,
    hasActiveAnalysis,
  }
})
