import { ref } from 'vue'

const FACILITY_CONFIG = {
  hospital: { label: '医院', file: '/data/qz_hospital.json', color: '#e74c3c', defaultRadius: 3 },
  primary_school: {
    label: '小学',
    file: '/data/qz_primary_school.json',
    color: '#3498db',
    defaultRadius: 1,
  },
  middle_school: {
    label: '中学',
    file: '/data/qz_middle_school.json',
    color: '#9b59b6',
    defaultRadius: 2,
  },
  park: { label: '公园', file: '/data/qz_park.json', color: '#2ecc71', defaultRadius: 1.5 },
  bus_station: {
    label: '公交站',
    file: '/data/qz_bus_station.json',
    color: '#f39c12',
    defaultRadius: 0.5,
  },
  mall: {
    label: '商场',
    file: '/data/qz_mall_and_supermarket.json',
    color: '#1abc9c',
    defaultRadius: 2,
  },
}

export function useFacilities() {
  const facilityData = ref({})
  const xiaoquData = ref([])
  const loading = ref(false)
  const loadError = ref('')

  async function loadAll() {
    loading.value = true
    loadError.value = ''
    try {
      const entries = Object.entries(FACILITY_CONFIG)
      const results = await Promise.all(
        entries.map(([, conf]) =>
          fetch(conf.file).then((res) => {
            if (!res.ok) throw new Error(`${conf.label}数据加载失败`)
            return res.json()
          }),
        ),
      )
      entries.forEach(([key], i) => {
        facilityData.value[key] = results[i]
      })

      const xiaoquRes = await fetch('/data/xiaoqu.json')
      if (!xiaoquRes.ok) throw new Error('小区数据加载失败')
      xiaoquData.value = await xiaoquRes.json()
    } catch (error) {
      console.error('设施数据加载失败:', error)
      loadError.value = error.message || '数据加载失败'
    } finally {
      loading.value = false
    }
  }

  return { facilityData, xiaoquData, loading, loadError, loadAll, FACILITY_CONFIG }
}
