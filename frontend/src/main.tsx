import React from 'react'
import {createRoot} from 'react-dom/client'
import './style.css'
import App from './App'
import { createWailsStudioAPI } from './api/wails'

const container = document.getElementById('root')
if (!container) throw new Error('Studio root element is missing')

const root = createRoot(container)

root.render(
    <React.StrictMode>
        <App api={createWailsStudioAPI()}/>
    </React.StrictMode>
)
