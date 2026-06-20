<script setup>
import { onMounted, onUnmounted } from 'vue'
import Map from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import OSM from 'ol/source/OSM'
import VectorSource from 'ol/source/Vector'
import VectorLayer from 'ol/layer/Vector'
import { fromLonLat } from 'ol/proj'
import Point from 'ol/geom/Point'
import Feature from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import 'ol/ol.css'
import ports from '@/data/ports.json'

const emit = defineEmits(['update:selectedPort'])

let map = null

onMounted(() => {
  const portFeatures = ports.map((port) => {
    const feature = new Feature({
      geometry: new Point(fromLonLat([port.lon, port.lat])),
    })
    feature.setProperties(port)
    feature.set('featureType', 'port') //加个标识
    return feature
  })
  const portSource = new VectorSource({
    features: portFeatures,
  })
  const portLayer = new VectorLayer({
    source: portSource,
  })
  const boundarySource = new VectorSource({
    url: '/北部湾裁切数据.geojson',
    format: new GeoJSON(),
  })
  const boundaryLayer = new VectorLayer({
    source: boundarySource,
  })
  map = new Map({
    target: 'map',
    view: new View({
      center: fromLonLat([108.6, 21.95]),
      zoom: 8,
    }),
    layers: [
      new TileLayer({
        source: new OSM(),
      }),
      boundaryLayer,
      portLayer,
    ],
  })
  map.on('click', (event) => {
    let clicked = false
    map.forEachFeatureAtPixel(event.pixel, (feature) => {
      console.log('type=', feature.get('type'))
      console.log('featureType=', feature.get('featureType'))
      if (feature.get('featureType') !== 'port') {
        return
      }
      clicked = true
      emit('update:selectedPort', feature.getProperties())
    })
    if (!clicked) {
      emit('update:selectedPort', null)
    }
  })
})
onUnmounted(() => {
  if (map) {
    map.setTarget(null)
    map = null
  }
})
</script>

<template>
  <div id="map"></div>
</template>

<style scoped>
#map {
  width: 100%;
  height: 100%;
}
</style>
