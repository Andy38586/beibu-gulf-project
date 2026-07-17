<script setup>
/**
 * CityBar - 4×1 城市定位横条
 *
 * 职责：
 * 1. 作为 Zone1 的第二行，提供钦州 / 防城港 / 北海三个城市定位入口
 * 2. 内部三个子 Panel 均分 4×1 容器宽度
 * 3. 点击后通过 flyTo 回调定位到对应城市中心
 *
 * Props:
 * - cities: 城市名称数组，默认 ['钦州', '防城港', '北海']
 */

import { computed } from 'vue'
import GcsPanel from './GcsPanel.vue'
import { useGCS } from '../useGCS.js'
import { GAP } from '../config.js'

defineProps({
  cities: { type: Array, default: () => ['钦州', '防城港', '北海'] },
})

const emit = defineEmits(['select'])

const { cellPixel } = useGCS()

const borderRadius = computed(() => `${cellPixel.value * 0.15}px`)

function handleClick(city) {
  emit('select', city)
}
</script>

<template>
  <GcsPanel :w="4" :h="1" anchor="top-left" :offset-x="0" :offset-y="0" class="city-bar">
    <div class="city-bar-inner" :style="{ gap: `${GAP}px` }">
      <button
        v-for="city in cities"
        :key="city"
        type="button"
        class="city-button"
        :style="{ borderRadius }"
        @click="handleClick(city)"
      >
        {{ city }}
      </button>
    </div>
  </GcsPanel>
</template>

<style scoped>
.city-bar {
  width: 100%;
  height: 100%;
}

.city-bar-inner {
  width: 100%;
  height: 100%;
  display: flex;
}

.city-button {
  flex: 1;
  border: none;
  outline: none;
  cursor: pointer;
  color: #fff;
  background-color: rgba(255, 255, 255, 0.12);
  font-size: 0.9em;
  font-weight: 500;
  transition: background-color 0.2s ease, transform 0.1s ease;
}

.city-button:hover {
  background-color: rgba(255, 255, 255, 0.22);
}

.city-button:active {
  transform: scale(0.98);
}
</style>
