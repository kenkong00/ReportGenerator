import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './style.css'

import Home from './pages/Home.vue'
import Live from './pages/Live.vue'
import Report from './pages/Report.vue'
import Settings from './pages/Settings.vue'
import Knowledge from './pages/Knowledge.vue'
import Prompts from './pages/Prompts.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: Home },
    { path: '/live/:id', name: 'live', component: Live, props: true },
    { path: '/report/:id', name: 'report', component: Report, props: true },
    { path: '/settings', name: 'settings', component: Settings },
    { path: '/knowledge', name: 'knowledge', component: Knowledge },
    { path: '/prompts', name: 'prompts', component: Prompts }
  ]
})

createApp(App).use(router).mount('#app')
